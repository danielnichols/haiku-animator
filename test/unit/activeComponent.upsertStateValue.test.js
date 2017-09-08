var test = require('tape')
var path = require('path')
var async = require('async')
var ActiveComponent = require('./../../src/model/ActiveComponent')
var generateCode = require('./../../src/ast/generateCode')

test('activeComponent.upsertStateValue', (t) => {
  t.plan(1)

  var ac = new ActiveComponent({
    alias: 'test',
    folder: path.join(__dirname, '..', 'fixtures', 'projects', 'dos'),
    userconfig: {},
    websocket: { send: () => {}, on: () => {} },
    platform: {},
    envoy: { mock: true }
  })

  // We would like to see diffs of the operations during this test
  ac.fetchActiveBytecodeFile().set('doShallowWorkOnly', false)
  ac.FileModel.UPDATE_OPTIONS.shouldUpdateFileSystem = false // Don't clobber the test fixtures
  ac.mountApplication()

  ac.on('component:mounted', () => {
    ac._componentInstance._context.clock.GLOBAL_ANIMATION_HARNESS.cancel()
    ac.fetchActiveBytecodeFile().read((err) => {
      return async.series([
        function (cb) {
          return ac.deleteStateValue('', { from: 'test' }, cb)
        },
        function (cb) {
          return setTimeout(cb, 1000)
        },
        function (cb) {
          return ac.upsertStateValue('rot', { value: '4.4' }, { from: 'test' }, cb)
        },
        function (cb) {
          return setTimeout(cb, 1000)
        },
        function (cb) {
          return ac.createKeyframe(['d0d263a2f0be'], 'Default', 'div', 'rotation.z', 0, {
            __function: {
              params: [{ 'rot': {} }],
              body: 'return rot'
            }
          }, null, null, null, { from: 'test' }, cb)
        },
        function (cb) {
          return setTimeout(cb, 1000)
        },
        function (cb) {
          return ac.upsertStateValue('rot', { value: '4.6' }, { from: 'test' }, cb)
        },
        function (cb) {
          return setTimeout(cb, 1000)
        }
      ], (err) => {
        if (err) throw err
        t.equal(JSON.stringify(ac.fetchActiveBytecodeFile().getSerializedBytecode()), '{"metadata":{"uuid":"HAIKU_SHARE_UUID","type":"haiku","name":"dos","relpath":"code/main/code.js"},"options":{},"states":{"rot":{"value":"4.6"}},"eventHandlers":{},"timelines":{"Default":{"haiku:d0d263a2f0be":{"style.WebkitTapHighlightColor":{"0":{"value":"rgba(0,0,0,0)"}},"style.position":{"0":{"value":"relative"}},"style.overflowX":{"0":{"value":"hidden"}},"style.overflowY":{"0":{"value":"hidden"}},"sizeAbsolute.x":{"0":{"value":550}},"sizeAbsolute.y":{"0":{"value":400}},"sizeMode.x":{"0":{"value":1}},"sizeMode.y":{"0":{"value":1}},"sizeMode.z":{"0":{"value":1}},"rotation.z":{"0":{"value":{"__function":{"type":"FunctionExpression","name":null,"params":[{"rot":"rot"}],"body":"return rot"}},"edited":true}}}}},"template":{"elementName":"div","attributes":{"haiku-title":"bytecode","haiku-id":"d0d263a2f0be"},"children":[]}}')
      })
    })
  })  
})
