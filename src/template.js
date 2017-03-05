var vanityHandlers = require('haiku-bytecode/src/properties/dom/vanities')
var ensureStyleProps = require('haiku-bytecode/src/properties/dom/ensureStyleProps')
var ensureLayoutProps = require('haiku-bytecode/src/properties/dom/ensureLayoutProps')
var queryTree = require('haiku-bytecode/src/cssQueryTree')
var Transitions = require('haiku-bytecode/src/Transitions')
var Utils = require('haiku-bytecode/src/Utils')
var Component = require('./component')
var Timeline = require('./timeline')
var Constants = require('./constants')

var CSS_QUERY_MAPPING = {
  name: 'elementName',
  attributes: 'attributes',
  children: 'children'
}

var FUNCTION_TYPE = 'function'
var STRING_TYPE = 'string'

function Template (template) {
  this.template = template
  this._changes = {}
  this._matches = {}
}

Template.prototype.getTree = function getTree () {
  return this.template
}

Template.prototype.expand = function _expand (context, component, inputs) {
  applyContextChanges(component, inputs, this.template, this)
  var tree = expandElement(this.template, context)
  return tree
}

Template.prototype.didChangeValue = function _didChangeValue (timelineName, selector, outputName, outputValue) {
  var answer = false
  if (!this._changes[timelineName]) {
    this._changes[timelineName] = {}
    answer = true
  }
  if (!this._changes[timelineName][selector]) {
    this._changes[timelineName][selector] = {}
    answer = true
  }
  if (this._changes[timelineName][selector][outputName] === undefined || this._changes[timelineName][selector][outputName] !== outputValue) {
    this._changes[timelineName][selector][outputName] = outputValue
    answer = true
  }
  return answer
}

function expandElement (element, context) {
  if (typeof element.elementName === FUNCTION_TYPE) {
    if (!element.__instance) element.__instance = instantiateElement(element, context)
    // Handlers attach first since they may want to respond to an immediate property setter
    if (element.__handlers) {
      for (var key in element.__handlers) {
        var handler = element.__handlers[key]
        if (!handler.__subscribed) {
          // We might have a component from a system that doesn't adhere to our own internal API
          if (element.__instance.instance) {
            element.__instance.instance.on(key, handler)
          }
          handler.__subscribed = true
        }
      }
    }
    // Cache previous messages and don't repeat any that have the same value as last time
    if (!element.previous) element.previous = {}
    for (var name in element.attributes) {
      if (element.previous[name] === element.attributes[name]) continue
      element.previous[name] = element.attributes[name]
      // We might have a component from a system that doesn't adhere to our own internal API
      if (element.__instance.instance) {
        element.__instance.instance[name] = element.attributes[name] // Apply top-down behavior
      }
    }
    var interior = element.__instance.render()
    return expandElement(interior, context)
  } else if (typeof element.elementName === STRING_TYPE) {
    var copy = shallowClone(element)
    // Handlers attach first since they may want to respond to an immediate property setter
    if (element.__handlers) {
      for (var nativekey in element.__handlers) {
        var nativehandler = element.__handlers[nativekey]
        if (!nativehandler.__subscribed) {
          element.attributes[nativekey] = nativehandler
          nativehandler.__subscribed = true
        }
      }
    }
    if (element.children && element.children.length > 0) {
      for (var i = 0; i < element.children.length; i++) {
        var child = element.children[i]
        copy.children[i] = expandElement(child, context)
      }
    }
    return copy
  }
  return element
}

function shallowClone (element) {
  var clone = {}
  clone.__instance = element.__instance // Hack: Important to cache instance
  clone.__handlers = element.__handlers // Hack: Important to transfer event handlers
  clone.__transformed = element.__transformed // ditto
  clone.layout = element.layout
  clone.elementName = element.elementName
  clone.attributes = {}
  for (var key in element.attributes) clone.attributes[key] = element.attributes[key]
  clone.children = [] // Assigned downstream
  return clone
}

function instantiateElement (element, context) {
  var something = element.elementName(element.attributes, element.children, context)
  var instance
  if (Component.isBytecode(something)) instance = new Component(something)
  if (Component.isComponent(something)) instance = something
  instance.attributes = instance.props = element.attributes
  instance.children = instance.surrogates = element.children
  instance.context = context // Hack: Important
  instance.startTimeline(Timeline.DEFAULT_NAME) // Ensure we cue up timelines
  return instance
}

function applyContextChanges (component, inputs, template, me) {
  var results = {}

  var bytecode = component.bytecode.bytecode

  if (bytecode.eventHandlers) {
    for (var j = 0; j < bytecode.eventHandlers.length; j++) {
      var eventHandler = bytecode.eventHandlers[j]
      var eventSelector = eventHandler.selector
      var eventName = eventHandler.name
      var handler = eventHandler.handler
      if (!results[eventSelector]) results[eventSelector] = {}
      handler.__handler = true
      results[eventSelector][eventName] = handler
    }
  }

  if (bytecode.timelines) {
    for (var timelineName in bytecode.timelines) {
      var timeline = component.store.get('timelines')[timelineName]
      if (!timeline) continue
      // No need to run properties on timelines that aren't active
      if (!timeline.isActive()) continue
      if (timeline.isFinished()) {
        // For any timeline other than the default, shut it down if it has gone past
        // its final keyframe. The default timeline is a special case which provides
        // fallbacks/behavior that is essentially true throughout the lifespan of the component
        if (timelineName !== Timeline.DEFAULT_NAME) {
          continue
        }
      }
      var now = timeline.local
      var outputs = bytecode.timelines[timelineName]
      for (var tlSelector in outputs) {
        var tlGroup = outputs[tlSelector]
        for (var outputname in tlGroup) {
          var cluster = tlGroup[outputname]
          var finalValue = Transitions.calculateValue(cluster, now, component, inputs)
          if (finalValue === undefined) return
          if (me.didChangeValue(timelineName, tlSelector, outputname, finalValue)) {
            // Set this here inside this condition to save iterations below
            // console.log(timelineName, tlSelector, outputname, finalValue) // <~ log me for fun
            if (!results[tlSelector]) results[tlSelector] = {}
            if (results[tlSelector][outputname] === undefined) results[tlSelector][outputname] = finalValue
            else results[tlSelector][outputname] = Utils.mergeValue(results[tlSelector][outputname], finalValue)
          }
        }
      }
    }
  }

  // Gotta do this here because handlers/vanities depend on these being set
  // TODO: Find a way to only do this once, or only by necessity instead of every frame
  fixTreeAttributes(template)

  for (var selector in results) {
    var matches = findMatchingElements(selector, template, me._matches)
    if (!matches || matches.length < 1) continue
    var group = results[selector]
    for (var i = 0; i < matches.length; i++) {
      var match = matches[i]
      if (group.transform) match.__transformed = true // Make note if the element has its own transform so the renderer doesn't clobber its own step
      for (var name in group) {
        var value = group[name]
        if (value.__handler) applyHandlerToElement(match, name, value)
        else applyPropertyToElement(match, name, value)
      }
    }
  }

  return template
}

function findMatchingElements (selector, template, cache) {
  if (cache[selector]) return cache[selector]
  var matches = queryTree([], template, selector, CSS_QUERY_MAPPING)
  cache[selector] = matches
  return matches
}

function fixTreeAttributes (tree) {
  if (!tree || typeof tree === 'string') return
  fixAttributes(tree)
  if (!tree.children) return
  if (tree.children.length < 1) return
  for (var i = 0; i < tree.children.length; i++) fixTreeAttributes(tree.children[i])
}

function fixAttributes (element) {
  ensureStyleProps(element)
  ensureLayoutProps(element)
  return element
}

function applyPropertyToElement (element, name, value) {
  if (vanityHandlers[element.elementName] && vanityHandlers[element.elementName][name]) {
    vanityHandlers[element.elementName][name](name, element, value)
  } else {
    element.attributes[name] = value
  }
}

function applyHandlerToElement (match, name, fn) {
  if (!match.__handlers) match.__handlers = {}
  match.__handlers[name] = fn
  return match
}

module.exports = Template
