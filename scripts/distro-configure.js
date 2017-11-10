var argv = require('yargs').argv
var fse = require('fs-extra')
var path = require('path')
var lodash = require('lodash')
var inquirer = require('inquirer')
var log = require('./helpers/log')
var writeHackyDynamicDistroConfig = require('./helpers/writeHackyDynamicDistroConfig')
var forceNodeEnvProduction = require('./helpers/forceNodeEnvProduction')

var ROOT = path.join(__dirname, '..')
var ENVS = { development: true, release: true }

forceNodeEnvProduction()

var inputs = lodash.assign({
  branch: 'master',
  environment: 'development',
  uglify: false,
  upload: true,
  shout: true,
  version: fse.readJsonSync(path.join(ROOT, 'package.json')).version
}, argv)

delete inputs.$0
delete inputs._

if (process.env.TRAVIS) {
  // Always assume the in-app NODE_ENV will be 'development' unless this is a release
  if (process.env.TRAVIS_BRANCH === 'release') {
    inputs.environment = 'release'
  }
}

if (!argv['non-interactive']) {
  inquirer.prompt([
    {
      type: 'input',
      name: 'environment',
      message: `Environment tag:`,
      default: inputs.environment
    },
    {
      type: 'confirm',
      name: 'uglify',
      message: 'Obfuscate source code in release bundle ("yes" is required for release)?:',
      default: inputs.uglify
    },
    {
      type: 'confirm',
      name: 'upload',
      message: 'Upload release to public distro server?:',
      default: inputs.upload
    },
    {
      type: 'confirm',
      name: 'shout',
      message: 'Notify our internal Slack account about build progress?:',
      default: inputs.shout
    }
  ]).then(function (answers) {
    lodash.assign(inputs, answers)

    if (inputs.uglify === false && inputs.environment === 'release') {
      throw new Error(`refusing to create a non-obfuscated build for 'release'`)
    }

    if (!ENVS[inputs.environment]) {
      throw new Error(`the 'environment' tag must be a member of ${JSON.stringify(ENVS)}`)
    }

    if (!inputs.version) {
      throw new Error(`a 'version' semver tag is required`)
    }

    log.log(`using these inputs: ${JSON.stringify(inputs, null, 2)}`)
    inquirer.prompt([
      {
        type: 'confirm',
        name: 'proceed',
        message: 'Go for configure?:',
        default: true
      }
    ]).then(function (answers) {
      if (answers.proceed) {
        writeHackyDynamicDistroConfig(inputs)
      } else {
        process.exit()
      }
    })
  }).catch(function (exception) {
    log.log(exception)
    process.exit()
  })
} else {
  console.log(JSON.stringify(inputs))
  writeHackyDynamicDistroConfig(inputs)
}
