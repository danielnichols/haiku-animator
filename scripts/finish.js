var lodash = require('lodash')
var cp = require('child_process')
var path = require('path')
var async = require('async')
var argv = require('yargs').argv
var inquirer = require('inquirer')
var log = require('./helpers/log')
var runScript = require('./helpers/runScript')
var nowVersion = require('./helpers/nowVersion')
var assertGitStatus = require('./helpers/assertGitStatus')
var ROOT = path.join(__dirname, '..')

/**
 * Run this script when you're done making changes and want to push your code.
 */

var inputs = lodash.assign({}, argv)
delete inputs._
delete inputs.$0
var _branch = cp.execSync('git symbolic-ref --short -q HEAD').toString().trim()
log.log(`fyi, your current mono branch is ${JSON.stringify(_branch)}\n`)
if (!inputs.branch) inputs.branch = _branch

async.series([
  function (cb) {
    inquirer.prompt([
      {
        type: 'input',
        name: 'branch',
        message: 'Branch:',
        default: inputs.branch || 'master'
      },
      {
        type: 'input',
        name: 'remote',
        message: 'Remote:',
        default: inputs.origin || 'origin'
      },
      {
        type: 'confirm',
        name: 'doLintPackages',
        message: 'Run the linter in all the packages? (warning: this may auto-format your code, resulting in unsaved changes)',
        default: false
      },
      {
        type: 'confirm',
        name: 'doTestPackages',
        message: 'Run automated tests in all the packages? (note: failed tests will _not_ block the rest of the steps)',
        default: false
      },
      {
        type: 'confirm',
        name: 'doDistro',
        message: 'Build distro (build Haiku.app, push to release channel etc.)?:',
        default: false // More often than not, we just want to push code, not release
      }
    ]).then(function (answers) {
      lodash.assign(inputs, answers)
      log.log(`finish inputs were: ${JSON.stringify(inputs, null, 2)}`)
      inquirer.prompt([
        {
          type: 'confirm',
          name: 'doProceed',
          message: 'ok to proceed with "finish"?',
          default: true
        }
      ]).then(function (answers) {
        if (answers.doProceed) {
          log.log('ok, proceeding...')
          return cb()
        } else {
          log.log('bailed.')
          process.exit()
        }
      })
    })
  },

  function (cb) {
    if (inputs.doLintPackages) {
      log.hat('linting all the packages')
      return runScript('lint-all', [], cb)
    } else {
      log.log('skipping linting because you said so')
      return cb()
    }
  },

  function (cb) {
    if (inputs.doTestPackages) {
      log.hat('running tests in all the packages')
      return runScript('test-all', [], cb)
    } else {
      log.log('skipping tests because you said so')
      return cb()
    }
  },

  function (cb) {
    // Need to check that linting/testing didn't create any changes that need to be fixed by a human
    assertGitStatus()
    return cb()
  },

  function (cb) {
    return runScript('git-subtree-pull', [`--branch=${inputs.branch}`], cb)
  },

  function (cb) {
    // If pulling created merge conflicts or other issues, we need to bail and let a human fix it
    assertGitStatus()
    return cb()
  },

  function (cb) {
    return runScript('semver', [], cb)
  },

  function (cb) {
    return runScript('build-player', [], cb)
  },

  function (cb) {
    return runScript('upload-cdn-player', [], cb)
  },

  function (cb) {
    cp.execSync('git add --all .', { cwd: ROOT, stdio: 'inherit' })
    cp.execSync(`git commit -m "auto: Housekeeping (changes)"`, { cwd: ROOT, stdio: 'inherit' })
    return cb()
  },

  function (cb) {
    return runScript('git-subtree-push', [`--branch=${inputs.branch}`], cb)
  },

  function (cb) {
    return runScript('publish-player', [], cb)
  },

  function (cb) {
    return runScript('sha-norm', [], cb)
  },

  function (cb) {
    cp.execSync('git add --all .', { cwd: ROOT, stdio: 'inherit' })
    cp.execSync(`git commit -m "auto: Housekeeping (dependencies)"`, { cwd: ROOT, stdio: 'inherit' })
    return cb()
  },

  function (cb) {
    return runScript('git-subtree-push', [`--branch=${inputs.branch}`], cb)
  },

  function (cb) {
    return runScript('changelog', [], cb)
  }
], function (err) {
  if (err) throw err
  log.hat(`finished! current version is ${nowVersion()}`, 'green')
})
