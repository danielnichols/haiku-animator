const cp = require('child_process')

const getPackages = require('./helpers/packages')
const log = require('./helpers/log')

const branch = cp.execSync('git symbolic-ref --short -q HEAD || git rev-parse --short HEAD').toString().trim()
if (branch !== 'master') {
  log.err('Push is only permitted from the master branch.')
  global.process.exit(1)
}

const ROOT = global.process.cwd()
const processOptions = { cwd: ROOT, stdio: 'inherit' }

// The set of all projects we want to open source.
const openSourceProjects = new Set([
  '@haiku/core',
  '@haiku/cli',
  'haiku-ui-common'
])

// Pull in the set of dependencies recursively.
const openSourcePackages = getPackages(Array.from(openSourceProjects))
const processedDependencies = new Set()
let foundNewDeps
do {
  foundNewDeps = false
  openSourcePackages.forEach((pack) => {
    if (processedDependencies.has(pack.name)) {
      return
    }

    if (pack.deps.size > 0) {
      getPackages(Array.from(pack.deps)).forEach((openSourcePackage) => {
        // Only push a new package onto the stack if it hasn't already been counted. It's possible for multiple packages
        // to depend on the same package which is not explicitly open sourced.
        if (
          openSourcePackages.find((exisitingPackage) => exisitingPackage.name === openSourcePackage.name) === undefined
        ) {
          openSourcePackages.push(openSourcePackage)
          foundNewDeps = true
        }
      })
    }

    processedDependencies.add(pack.name)
  })
} while (foundNewDeps)

// Perform hard reset.
cp.execSync(`git reset --hard origin/master`)

// Pull standalone remotes.
openSourcePackages.forEach((pack) => {
  cp.execSync(`node ./scripts/git-subtree-pull.js --package=${pack.name}`, processOptions)
})

cp.execSync(`node ./scripts/git-subtree-pull.js --package=changelog`, processOptions)

// Bump semver in all projects, plus their @haiku/* dependencies, and commit.
cp.execSync(`node ./scripts/semver.js --non-interactive`, processOptions)
cp.execSync(`git add -u`, processOptions)
cp.execSync(`git commit -m "auto: Bumps semver."`, processOptions)

// Regenerate changelog and push to remote.
cp.execSync(`node ./scripts/changelog.js`, processOptions)
cp.execSync(`git add -u`, processOptions)

// git commit might fail if there is no changelog. Not a big deal.
try {
  cp.execSync(`git commit -m "auto: Updates changelog."`, processOptions)
} catch (e) {}

// Compile packages.
cp.execSync('yarn install --frozen-lockfile', processOptions)
cp.execSync('yarn compile-all --force', processOptions)
openSourcePackages.forEach((pack) => {
  const compileCommand = `node ./scripts/compile-package.js --package=${pack.name}`
  if (!openSourceProjects.has(pack.name) || pack.name.startsWith('haiku-')) {
    // Uglify pure dependencies.
    cp.execSync(`${compileCommand} --uglify=lib/**/*.js`, processOptions)
  }
})

// @haiku/core needs a special build.
cp.execSync(`node ./scripts/build-core.js --skip-compile=1`, processOptions)

// Push up before we begin the actual work of publishing. This ensures that unmergeable changes are never published to
// our standalones.
cp.execSync('git fetch')
cp.execSync('git merge origin/master')
cp.execSync('git push -u origin master')
// Sync these changes down to development before continuing.
cp.execSync('git fetch origin development:development')
cp.execSync('git checkout development')
cp.execSync('git merge master')
cp.execSync('git push -u origin development')
cp.execSync('git checkout master')

openSourcePackages.forEach((pack) => {
  // Publish package to NPM as is.
  cp.execSync(`node ./scripts/publish-package.js --package=${pack.name}`, processOptions)
})

// Publish @haiku/core to CDN.
cp.execSync(`node ./scripts/upload-cdn-core.js`, processOptions)

// Push standalone remotes.
openSourcePackages.forEach((pack) => {
  cp.execSync(`node ./scripts/git-subtree-push.js --package=${pack.name}`, processOptions)
})
cp.execSync(`node ./scripts/git-subtree-push.js --package=changelog`, processOptions)
