import async from 'async'
import path from 'path'
import { debounce } from 'lodash'
import { ExporterFormat } from 'haiku-sdk-creator/lib/exporter'
import fse from 'haiku-fs-extra'
import HaikuComponent from '@haiku/core/lib/HaikuComponent'
import walkFiles from 'haiku-serialization/src/utils/walkFiles'
import BaseModel from 'haiku-serialization/src/bll/BaseModel'
import File from 'haiku-serialization/src/bll/File'
import Project from 'haiku-serialization/src/bll/Project'
import Sketch from 'haiku-serialization/src/bll/Sketch'
import Figma from 'haiku-serialization/src/bll/Figma'
import logger from 'haiku-serialization/src/utils/LoggerInstance'
import MockWebsocket from 'haiku-serialization/src/ws/MockWebsocket'
import { EventEmitter } from 'events'
import EmitterManager from 'haiku-serialization/src/utils/EmitterManager'
import * as Git from './Git'
import Watcher from './Watcher'
import * as ProjectFolder from './ProjectFolder'
import MasterGitProject from './MasterGitProject'
import MasterModuleProject from './MasterModuleProject'
import attachListeners from './envoy/attachListeners'
import saveExport from './publish-hooks/saveExport'

Sketch.findAndUpdateInstallPath()

const Raven = require('./Raven')

const UNLOGGABLE_METHODS = {
  'masterHeartbeat': true
}

const METHODS_TO_RUN_IMMEDIATELY = {
  'startProject': true,
  'initializeFolder': true,
  'masterHeartbeat': true
}

const FORBIDDEN_METHODS = {
  logMethodMessage: true,
  handleMethodMessage: true,
  callMethodWithMessage: true
}

const METHOD_QUEUE_INTERVAL = 64
const SAVE_AWAIT_TIME = 64 * 2

const WATCHABLE_EXTNAMES = {
  '.js': true,
  '.svg': true,
  '.sketch': true
}

const DESIGN_EXTNAMES = {
  '.sketch': true,
  '.svg': true
}

const UNWATCHABLE_RELPATHS = {
  'index.js': true,
  'react-bare.js': true,
  'react.js': true,
  'vue.js': true
}

const UNWATCHABLE_BASENAMES = {
  'angular-dom.js': true,
  'index.standalone.js': true,
  'index.embed.js': true,
  'dom-embed.js': true,
  'dom-standalone.js': true,
  'react-dom.js': true,
  'vue-dom.js': true,
  '~.sketch': true // Ephemeral file generated by sketch during file writes
}

function _isFileSignificant (relpath) {
  if (UNWATCHABLE_RELPATHS[relpath]) return false
  if (UNWATCHABLE_BASENAMES[path.basename(relpath)]) return false
  if (!WATCHABLE_EXTNAMES[path.extname(relpath)]) return false
  return true
}

function _excludeIfNotJs (relpath) {
  if (path.extname(relpath) !== '.js') return true
  return !_isFileSignificant(relpath)
}

export default class Master extends EventEmitter {
  constructor (folder, fileOptions = {}, envoyOptions = {}) {
    super()

    EmitterManager.extend(this)

    this.folder = folder

    if (!this.folder) {
      throw new Error('[master] Master cannot launch without a folder defined')
    }

    this.fileOptions = fileOptions

    // The Project model is also configurable through 'fileOptions' (#FIXME)
    // and it allows us to specify methods that we want to handle directly instead
    // of being routed to internal methods it may have with the same name.
    // Pretty much what we're saying here is: "All our methods should be ignored".
    // This accounts for the legacy Master setup and needs a refactor.
    this.fileOptions.methodsToIgnore = this

    this.envoyOptions = envoyOptions

    // Encapsulation of project actions that relate to git or cloud saving in some way
    this._git = new MasterGitProject(this.folder)

    this._git.on('semver-bumped', (tag, cb) => {
      this.handleSemverTagChange(tag, cb)
    })

    // Encapsulation of project actions that concern the live module in other views
    this._mod = new MasterModuleProject(this.folder)

    this._mod.on('component:reload', (file) => {
      // Our bytecode and models have to be up to date before we can receive actions
      // We update ours first since we need to reflect what will get committed to disk
      this.getActiveComponent().moduleReplace(() => {
        this.emit('component:reload', this, file)
      })
    })

    // To store a Watcher instance which will watch for changes on the file system
    this._watcher = null

    // Flag denotes whether we've fully initialized and are able to handle methods
    this._isReadyToReceiveMethods = false

    // Queue of accumulated incoming methods we've received that we need to defer until ready
    this._methodQueue = []

    // Worker that handles processing any methods that have accumulated in our queue
    this._methodQueueInterval = setInterval(() => {
      if (this._isReadyToReceiveMethods) {
        const methods = this._methodQueue.splice(0)
        methods.forEach(({ message: { method, params }, cb }) => {
          this.callMethodWithMessage(method, params, cb)
        })
        clearInterval(this._methodQueueInterval)
      }
    }, METHOD_QUEUE_INTERVAL)

    // Dictionary of all library-listable assets in the project, mapping relpath to metadata object
    this._knownLibraryAssets = {}

    // Designs that have changed and need merge, batched for
    this._designsPendingMerge = {}

    // Store an Project instance for method delegation into the BLL
    this.project = null

    // Saving takes a while and we use this flag to avoid overlapping saves
    this._isSaving = false

    // Save some expensive fs logic by tracking whether we've walked the project fs initially
    this._wereAssetsInitiallyLoaded = false

    // We end up oversaturating the sockets unless we debounce this
    this.debouncedEmitAssetsChanged = debounce(this.emitAssetsChanged.bind(this), 100, { trailing: true })
    this.debouncedEmitDesignNeedsMergeRequest = debounce(this.emitDesignNeedsMergeRequest.bind(this), 500, { trailing: true })
  }

  handleBroadcast (message) {
    switch (message.name) {
      case 'remote-model:receive-sync':
        BaseModel.receiveSync(message)
        break

      case 'component:reload:complete':
        this._mod.handleReloadComplete(message)
        break
    }
  }

  getActiveComponent () {
    return this.project && this.project.getCurrentActiveComponent()
  }

  watchOff () {
    if (this._watcher) {
      this._watcher.stop()
    }
  }

  watchOn () {
    this._watcher = new Watcher()
    this._watcher.watch(this.folder)
    this._watcher.on('change', this.handleFileChange.bind(this))
    this._watcher.on('change-blacklisted', this.handleFileChangeBlacklisted.bind(this))
    this._watcher.on('add', this.handleFileAdd.bind(this))
    this._watcher.on('remove', this.handleFileRemove.bind(this))
  }

  teardown (cb) {
    clearInterval(this._methodQueueInterval)
    clearInterval(this._mod._modificationsInterval)
    if (this.project) {
      this.project.teardown()
    }
    if (this._watcher) {
      this._watcher.stop()
    }
    if (this._git) {
      return this._git.teardown(cb)
    } else {
      return cb()
    }
  }

  logMethodMessage (method, params) {
    if (!UNLOGGABLE_METHODS[method]) {
      logger.info('[master]', 'calling', method, params)
    }
  }

  handleMethodMessage (method, params, cb) {
    // We stop using the queue once we're up and running; no point keeping the queue
    if (METHODS_TO_RUN_IMMEDIATELY[method] || this._isReadyToReceiveMethods) {
      return this.callMethodWithMessage(method, params, cb)
    } else {
      return this._methodQueue.push({ message: { method, params }, cb })
    }
  }

  callMethodWithMessage (method, params, cb) {
    if (FORBIDDEN_METHODS[method]) {
      return cb(new Error(`Method ${method} forbidden`))
    }

    // We should *always* receive the metadata {from: 'alias'} object here!
    const metadata = params.pop()

    if (typeof this[method] === 'function') {
      this.logMethodMessage(method, params)
      // Our own API does not expect the metadata object; leave it off
      return this[method].apply(this, params.concat(cb))
    }

    return this.project.receiveMethodCall(method, params.concat(metadata), { /* message */ }, cb)
  }

  waitForSaveToComplete (cb) {
    if (this._isSaving) {
      return setTimeout(() => {
        return this.waitForSaveToComplete(cb)
      }, SAVE_AWAIT_TIME)
    } else {
      return cb()
    }
  }

  emitAssetsChanged (assets) {
    File.cache.clear()
    return this.emit('assets-changed', this, assets)
  }

  emitDesignNeedsMergeRequest () {
    const designs = this._designsPendingMerge
    if (Object.keys(designs).length > 0) {
      logger.info('[master] merge designs requested')
      if (this.project && this.project.getCurrentActiveComponent()) {
        this._designsPendingMerge = {}
        this.emit(
          'merge-designs',
          designs
        )
      }
    }
  }

  batchDesignMergeRequest (relpath, abspath) {
    this._designsPendingMerge[relpath] = abspath
    return this
  }

  emitComponentChange (relpath) {
    logger.info('[master] component changed', relpath)
    this.debouncedEmitAssetsChanged(this._knownLibraryAssets)
  }

  emitDesignChange (relpath) {
    const extname = path.extname(relpath)
    const abspath = path.join(this.folder, relpath)
    logger.info('[master] design changed', relpath)
    this.debouncedEmitAssetsChanged(this._knownLibraryAssets)
    if (extname === '.svg') {
      this.batchDesignMergeRequest(relpath, abspath)
      this.debouncedEmitDesignNeedsMergeRequest()
    }
  }

  // /**
  //  * watchers/handlers
  //  * =================
  //  */

  /**
   * @description The default file-change watcher, handleFileChange, is write-aware,
   * meaning that it ignores changes if a disk write is occuring as an optimization.
   * However, we still want to do a Git commit on atomic changes, so this listener
   * subscribes to *all* updates, even updates that have been 'blacklisted'.
   */
  handleFileChangeBlacklisted (abspath) {
    const relpath = path.relative(this.folder, abspath)
    return this.waitForSaveToComplete(() => {
      return this._git.commitFileIfChanged(relpath, `Changed ${relpath}`, () => {})
    })
  }

  handleFileChange (abspath) {
    const relpath = path.relative(this.folder, abspath)
    const extname = path.extname(relpath)
    const basename = path.basename(relpath, extname)

    if (extname === '.sketch' || extname === '.svg') {
      this._knownLibraryAssets[relpath] = { relpath, abspath, dtModified: Date.now() }
      this.emitDesignChange(relpath)
    } else if (path.basename(relpath) === 'code.js') { // Local component file
      this._knownLibraryAssets[relpath] = { relpath, abspath, dtModified: Date.now() }
      this.emitComponentChange(relpath)
    }

    return this.waitForSaveToComplete(() => {
      return this._git.commitFileIfChanged(relpath, `Changed ${relpath}`, () => {
        if (!_isFileSignificant(relpath)) {
          return
        }

        if (extname === '.sketch') {
          logger.info('[master] sketchtool pipeline running; please wait')
          Sketch.sketchtoolPipeline(abspath)
          logger.info('[master] sketchtool done')
          return
        }

        if (extname === '.js' && basename === 'code') {
          return File.ingestOne(this.project, this.folder, relpath, (err, file) => {
            if (err) return logger.info(err)
            logger.info('[master] file ingested (changed):', abspath)

            if (!this.getActiveComponent()) {
              return
            }

            if (relpath !== this.getActiveComponent().fetchActiveBytecodeFile().relpath) {
              return
            }

            this._mod.handleModuleChange(file)
          })
        }
      })
    })
  }

  handleFileAdd (abspath) {
    const relpath = path.relative(this.folder, abspath)
    const extname = path.extname(relpath)
    const basename = path.basename(relpath, extname)

    if (extname === '.sketch' || extname === '.svg') {
      this._knownLibraryAssets[relpath] = { relpath, abspath, dtModified: Date.now() }
      this.emitDesignChange(relpath)
    } else if (path.basename(relpath) === 'code.js') { // Local component file
      this._knownLibraryAssets[relpath] = { relpath, abspath, dtModified: Date.now() }
      this.emitComponentChange(relpath)
    }

    return this.waitForSaveToComplete(() => {
      return this._git.commitFileIfChanged(relpath, `Added ${relpath}`, () => {
        if (!_isFileSignificant(relpath)) {
          return
        }

        if (extname === '.sketch') {
          logger.info('[master] sketchtool pipeline running; please wait')
          Sketch.sketchtoolPipeline(abspath)
          logger.info('[master] sketchtool done')
          return
        }

        if (extname === '.js' && basename === 'code') {
          return File.ingestOne(this.project, this.folder, relpath, (err, file) => {
            if (err) return logger.info(err)
            logger.info('[master] file ingested (added):', abspath)

            if (!this.getActiveComponent()) {
              return
            }

            if (relpath !== this.getActiveComponent().fetchActiveBytecodeFile().relpath) {
              return
            }
          })
        }
      })
    })
  }

  handleFileRemove (abspath) {
    const relpath = path.relative(this.folder, abspath)
    const extname = path.extname(relpath)

    delete this._knownLibraryAssets[relpath]

    return this.waitForSaveToComplete(() => {
      return this._git.commitFileIfChanged(relpath, `Removed ${relpath}`, () => {
        if (!_isFileSignificant(relpath)) {
          return
        }

        if (extname === '.js') {
          return File.expelOne(this.folder, relpath, (err) => {
            if (err) return logger.info(err)
            logger.info('[master] file expelled:', abspath)
          })
        }
      })
    })
  }

  handleSemverTagChange (tag, cb) {
    // Just in case this happens to get called before we initialize
    if (!this.project) {
      return cb(null, tag)
    }

    // Just in case we haven't initialized our active component yet
    const acs = this.project.getAllActiveComponents()

    if (acs.length < 1) {
      return cb()
    }

    // Loop through all components and bump their bytecode metadata semver
    return async.eachSeries(acs, (ac, next) => {
      // Since we might be tagging components that we have never initially loaded,
      // we do so here otherwise the reified bytecode is going to be null
      return ac.moduleReload('basicReload', (err) => {
        if (err) return next(err)

        return ac.writeMetadata(
          {version: tag},
          (err) => {
            if (err) return next(err)
            logger.info(`[master-git] bumped bytecode semver on ${ac.getSceneName()} to ${tag}`)
            return next(null, tag)
          }
        )
      })
    }, (err) => {
      if (err) return cb(err)
      return cb(null, tag)
    })
  }

  // /**
  //  * methods
  //  * =======
  //  */

  masterHeartbeat (cb) {
    const state = {
      folder: this.folder,
      isReady: this._isReadyToReceiveMethods,
      isSaving: this._isSaving,
      isCommitting: this._git.hasAnyPendingCommits()
    }

    return cb(null, state)
  }

  doesProjectHaveUnsavedChanges (cb) {
    return Git.status(this.folder, {}, (statusErr, statusesDict) => {
      if (statusErr) return cb(statusErr)
      if (Object.keys(statusesDict).length < 1) return cb(null, false)
      return cb(null, true)
    })
  }

  discardProjectChanges (cb) {
    return Git.hardReset(this.folder, 'HEAD', (err) => {
      if (err) return cb(err)
      return Git.removeUntrackedFiles(this.folder, (err) => {
        if (err) return cb(err)
        return cb()
      })
    })
  }

  getAssets (cb) {
    return cb(null, this._knownLibraryAssets)
  }

  loadAssets (cb) {
    return walkFiles(this.folder, (err, entries) => {
      if (err) return cb(err)
      entries.forEach((entry) => {
        const extname = path.extname(entry.path)
        const basename = path.basename(entry.path)
        const relpath = path.normalize(path.relative(this.folder, entry.path))
        const parts = relpath.split(path.sep)
        if (DESIGN_EXTNAMES[extname]) {
          this._knownLibraryAssets[relpath] = { relpath, abspath: entry.path, dtModified: Date.now() }
        } else if (parts[0] === 'code' && basename === 'code.js') { // Component bytecode file
          this._knownLibraryAssets[relpath] = { relpath, abspath: entry.path, dtModified: Date.now() }
        }
      })
      return this.getAssets(cb)
    })
  }

  fetchAssets (cb) {
    if (this._wereAssetsInitiallyLoaded) {
      return this.getAssets(cb)
    } else {
      this._wereAssetsInitiallyLoaded = true
      return this.loadAssets(cb)
    }
  }

  linkAsset (abspath, cb) {
    const basename = path.basename(abspath)
    const relpath = path.join('designs', basename)
    const destination = path.join(this.folder, relpath)
    return fse.copy(abspath, destination, (copyErr) => {
      if (copyErr) return cb(copyErr)
      this._knownLibraryAssets[relpath] = { relpath, abspath: destination, dtModified: Date.now() }
      return cb(null, this._knownLibraryAssets)
    })
  }

  bulkLinkAssets (abspaths, cb) {
    return async.eachSeries(
      abspaths,
      (path, next) => {
        return this.linkAsset(path, (error, assets) => {
          if (error) return next(error)
          return next()
        })
      },
      (error, results) => {
        if (error) return cb(error)
        return cb(results)
      }
    )
  }

  unlinkAsset (relpath, cb) {
    if (!relpath || relpath.length < 2) {
      return cb(new Error('Relative path too short'))
    }

    const abspath = path.join(this.folder, relpath)

    /* Remove the file and all associated assets from the in-memory registry */
    Object.keys(this._knownLibraryAssets)
      .filter((path) => path.indexOf(relpath) !== -1)
      .forEach((path) => delete this._knownLibraryAssets[path])

    return async.series(
      [
        /* Remove associated Sketch contents from disk */
        (cb) => {
          Sketch.isSketchFile(abspath) || Figma.isFigmaFile(abspath)
            ? fse.remove(`${abspath}.contents`, cb)
            : cb()
        },
        /* Remove the file itself */
        (cb) => {
          fse.remove(abspath, cb)
        }
      ],
      error => {
        return cb(error, this._knownLibraryAssets)
      }
    )
  }

  readAllStateValues (relpath, cb) {
    if (!this.project || !relpath) {
      logger.warn(`[master] cannot read states ${!!this.project}/${!!relpath}`)
      return cb(null, {})
    }

    const ac = this.project.findActiveComponentBySource(relpath)
    if (!ac) {
      return cb(null, {})
    }

    return ac.readAllStateValues({ /* unused metadata */ }, cb)
  }

  readAllEventHandlers (relpath, cb) {
    if (!this.project || !relpath) {
      logger.warn(`[master] cannot read actions ${!!this.project}/${!!relpath}`)
      return cb(null, {})
    }

    const ac = this.project.findActiveComponentBySource(relpath)
    if (!ac) {
      return cb(null, {})
    }

    return ac.readAllEventHandlers({ /* unused metadata */ }, cb)
  }

  /**
   * @method initializeFolder
   */
  initializeFolder (projectName, haikuUsername, haikuPassword, projectOptions, done) {
    // We need to clear off undos in the case that somebody made an fs-based commit between sessions;
    // if we tried to reset to a previous "known" undoable, we'd miss the missing intermediate one.
    // This has to happen in initializeFolder because it's here that we set the 'isBase' undoable.
    this._git.restart({
      projectName,
      haikuUsername,
      haikuPassword,
      repositoryUrl: projectOptions.repositoryUrl,
      branchName: projectOptions.branchName
    })

    const ravenContext = {
      user: { email: haikuUsername },
      extra: {
        projectName: Project.getSafeProjectName(this.folder, projectName),
        projectPath: this.folder,
        organizationName: Project.getSafeOrgName(projectOptions.organizationName)
      }
    }
    Raven.setContext(ravenContext)

    // Note: 'ensureProjectFolder' should already have run by this point.
    return async.series([
      (cb) => {
        return this._git.initializeFolder(projectOptions, cb)
      },

      // Now that we've (maybe) cloned content, we need to create any other necessary files that _might not_ yet
      // exist in the folder. You may note that we run this method _before_ this process, and ask yourself: why twice?
      // Well, don't be fooled. Both methods are necessary due to the way git pulling is handled: if a project has
      // never had remote content pulled, but has changes, we move those changes away them copy them back in on top of
      // the cloned content. Which means we have to be sparing with what we create on the first run, but also need
      // to create any missing remainders on the second run.
      (cb) => {
        return ProjectFolder.buildProjectContent(null, this.folder, projectName, 'haiku', {
          organizationName: projectOptions.organizationName, // Important: Must set this here or the package.name will be wrong
          skipContentCreation: false,
          skipCDNBundles: true,
          isPublic: projectOptions.isPublic
        }, cb)
      },

      (cb) => {
        return this._git.commitProjectIfChanged('Initialized folder', cb)
      }
    ], (err, results) => {
      if (err) return done(err)
      return done(null, results[results.length - 1])
    })
  }

  /**
   * @method startProject
   */
  startProject (done) {
    const loggingPrefix = (done.restart) ? 'restart project' : 'start project'

    logger.info(`[master] ${loggingPrefix}: ${this.folder}`)

    this._mod.restart()
    this._git.restart()

    return Project.fetchProjectConfigInfo(this.folder, (err, userconfig) => {
      if (err) throw err

      const response = {
        projectName: userconfig.project
      }

      return async.series([
        // Initialize the ActiveComponent and file models
        (cb) => {
          logger.info(`[master] ${loggingPrefix}: setting up project`)
          return Project.setup(
            this.folder,
            'master', // alias
            // websocket - a mock, since in theory no Master method will originate
            // here and need to be sent outward to the other clients automatically
            new MockWebsocket(),
            {}, // platform
            userconfig,
            this.fileOptions,
            this.envoyOptions,
            (err, project) => {
              if (err) return cb(err)
              this.handleProjectReady(project)
              return cb()
            }
          )
        },

        // Load all relevant files into memory (only JavaScript files for now)
        (cb) => {
          logger.info(`[master] ${loggingPrefix}: ingesting js files in ${this.folder}`)
          return File.ingestFromFolder(this.project, this.folder, {
            exclude: _excludeIfNotJs
          }, cb)
        },

        // Take an initial commit of the starting state so we have a baseline
        (cb) => {
          return this._git.commitProjectIfChanged('Project setup', cb)
        },

        // Start watching the file system for changes
        (cb) => {
          logger.info(`[master] ${loggingPrefix}: initializing file watcher`, this.folder)
          this.watchOn()
          logger.info(`[master] ${loggingPrefix}: file watcher is now watching`, this.folder)
          return cb()
        },

        // Finish up and signal that we are ready
        (cb) => {
          this._isReadyToReceiveMethods = true
          logger.info(`[master] ${loggingPrefix}: ready`)
          return cb(null, response)
        }
      ], (err, results) => {
        if (err) return done(err)
        return done(null, results[results.length - 1])
      })
    })
  }

  /**
   * @method requestSyndicationInfo
   */
  requestSyndicationInfo (done) {
    return this._git.getCurrentShareInfo(done)
  }

  /**
   * @method saveProject
   */
  saveProject (projectName, haikuUsername, haikuPassword, saveOptions, done) {
    const finish = (err, out) => {
      this._isSaving = false
      return done(err, out)
    }

    if (this._isSaving) {
      logger.info('[master] project save: already in progress! short circuiting')
      return done()
    }

    this._isSaving = true

    logger.info('[master] project save')

    return async.series([
      // Check to see if a save is even necessary, and return early if not
      (cb) => {
        return this._git.getExistingShareDataIfSaveIsUnnecessary((err, existingShareData) => {
          if (err) return cb(err)
          if (existingShareData) { // Presence of share data means early return
            return cb(true, existingShareData) // eslint-disable-line
          }
          return cb() // Falsy share data means perform the save
        })
      },

      // Ensure we bump the semver before proceeding.
      (cb) => {
        return this._git.bumpSemverAppropriately(cb)
      },

      // Populate the bytecode's metadata. This may be a no-op if the file has already been saved
      (cb) => {
        // Just in case this ran somehow before we initialized the project
        if (!this.project) {
          return cb()
        }

        // Just in case we haven't initialized any active components yet
        const acs = this.project.getAllActiveComponents()
        if (acs.length < 1) return cb()

        return async.eachSeries(acs, (ac, next) => {
          logger.info(`[master] project save: assigning metadata to ${ac.getSceneName()}`)

          return Project.fetchProjectConfigInfo(ac.fetchActiveBytecodeFile().folder, (err, userconfig) => {
            if (err) return next(err)

            return ac.writeMetadata(
              userconfig,
              (err) => {
                if (err) return next(err)
                // #FIXME: we should have a mechanism to force flush in cases where we actually want I/O to be blocking.
                return ac.fetchActiveBytecodeFile().awaitNoFurtherContentFlushes(next)
              }
            )
          })
        }, (err) => {
          if (err) return cb(err)
          return cb()
        })
      },

      // Write out any enabled exported formats.
      (cb) => {
        // This might be a save without any designated exports
        const {exporterFormats} = saveOptions
        if (!exporterFormats) {
          return cb()
        }

        // Just in case this ran somehow before the project was initialized
        if (!this.project) {
          return cb()
        }

        // Just in case we haven't initialized any active components yet
        const acs = this.project.getAllActiveComponents()
        if (acs.length < 1) return cb()

        // Create a fault-tolerant async series to process all requested formats for all components
        return async.eachSeries(acs, (ac, nextComponent) => {
          logger.info(`[master] project save: writing exported formats for ${ac.getSceneName()}`)

          return async.series(exporterFormats.map((format) => (nextFormat) => {
            // For now, we only support one exported format: lottie.json
            let filename
            switch (format) {
              case ExporterFormat.Bodymovin:
                filename = ac.getAbsoluteLottieFilePath()
                break
              case ExporterFormat.HaikuStatic:
                filename = ac.getAbsoluteHaikuStaticFilePath()
                break
            }

            return saveExport({format, filename}, ac, (err) => {
              if (err) {
                logger.warn(`[master] error during export for ${ac.getSceneName()}: ${err.toString()}`)
              }

              return nextFormat()
            })
          }), nextComponent)
        }, (err) => {
          if (err) return cb(err)
          return cb()
        })
      },

      // Build the rest of the content of the folder, including any bundles that belong on the cdn
      (cb) => {
        logger.info('[master] project save: populating content')

        const { projectName } = this._git.getFolderState()
        ProjectFolder.buildProjectContent(null, this.folder, projectName, 'haiku', {
          projectName: projectName,
          haikuUsername: haikuUsername,
          authorName: saveOptions.authorName,
          organizationName: saveOptions.organizationName
        }, cb)
      },

      (cb) => {
        this._git.commitProjectIfChanged('Updated metadata', cb)
      },

      // Now do all of the git/share/publish/fs operations required for the real save
      (cb) => {
        logger.info('[master] project save: creating snapshot')
        this._git.saveProject(saveOptions, cb)
      }
    ], (err, results) => { // async gives back _all_ results from each step
      if (err && err !== true) {
        finish(err)
        return
      }

      finish(null, results[results.length - 1])

      // Silently push results to the remote.
      this._git.pushToRemote((err) => {
        if (err) {
          logger.warn('[master] silent project push failed')
        }
      })
    })
  }

  handleProjectReady (project) {
    this.project = project

    // This safely reinitializes Plumbing websockets and Envoy clients
    // Note that we only need to do this here in Master because our process
    // remains alive even as the user navs between projects
    this.project.connectClients()

    // Clear the undo/redo stack (etc) from the previous editing session if any is left over,
    // and ensure that the action stack is no longer in a 'stopped' state
    this.project.actionStack.resetData()

    this.addEmitterListenerIfNotAlreadyRegistered(this.project, 'update', (what, ...args) => {
      // logger.info(`[master] local update ${what}`)

      switch (what) {
        case 'setCurrentActiveComponent': return this.handleActiveComponentReady()
        case 'application-mounted': return this.handleHaikuComponentMounted()
        default: return null
      }
    })

    this.addEmitterListenerIfNotAlreadyRegistered(this.project, 'remote-update', (what, ...args) => {
      // logger.info(`[master] remote update ${what}`)

      switch (what) {
        case 'setCurrentActiveComponent': return this.handleActiveComponentReady()
        default: return null
      }
    })

    this.addEmitterListenerIfNotAlreadyRegistered(this.project, 'envoy:timelineClientReady', (timelineChannel) => {
      timelineChannel.on('didSeek', ({frame}) => {
        const ac = this.project.getCurrentActiveComponent()
        if (ac) {
          ac.setCurrentTimelineFrameValue(frame)
        }
      })
    })

    this.emit('project-state-change', { what: 'project-ready' })
  }

  handleActiveComponentReady () {
    return this.awaitActiveComponent(() => {
      attachListeners(this.project.getEnvoyClient(), this.getActiveComponent())

      // I'm not actually sure this needs to run here; doesn't project do this?
      this.getActiveComponent().mountApplication(null, {
        freeze: true
      })
    })
  }

  awaitActiveComponent (cb) {
    if (!this.getActiveComponent()) {
      return setTimeout(() => this.awaitActiveComponent(cb), 100)
    }
    return cb()
  }

  handleHaikuComponentMounted () {
    return this.awaitActiveComponent(() => {
      // Since we aren't running in the DOM cancel the raf to avoid leaked handles
      HaikuComponent.all().forEach((instance) => {
        instance.context.clock.GLOBAL_ANIMATION_HARNESS.cancel()
      })

      this.emit('project-state-change', {
        what: 'component:mounted',
        scenename: this.getActiveComponent().getSceneName()
      })
    })
  }
}
