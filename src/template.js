var vanityHandlers = require('haiku-bytecode/src/properties/dom/vanities')
var queryTree = require('haiku-bytecode/src/cssQueryTree')
var Layout3D = require('haiku-bytecode/src/Layout3D')
var scopifyElements = require('haiku-bytecode/src/scopifyElements')
var initializeTreeAttributes = require('./helpers/initializeTreeAttributes')
var Component = require('./component')
var Timeline = require('./timeline')

var IDENTITY_MATRIX = Layout3D.createMatrix()
var HAIKU_ID_ATTRIBUTE = 'haiku-id'
var CSS_QUERY_MAPPING = {
  name: 'elementName',
  attributes: 'attributes',
  children: 'children'
}
var FUNCTION_TYPE = 'function'
var STRING_TYPE = 'string'

function Template (template, component) {
  this.template = template
  this.component = component
  this._matches = {}
  this._controllerEventHandlers = []
}

Template.prototype.getTree = function getTree () {
  return this.template
}

Template.prototype.expand = function _expand (context, component, container, inputs, options) {
  applyContextChanges(component, inputs, this.template, container, this, context, options || {})
  var tree = expandElement(this.template, context)
  return tree
}

Template.prototype.eventListenerDeltas = function _eventListenerDeltas (context, component, container, inputs, timelinesRunning, eventsFired, inputsChanged) {
  var deltas = gatherEventListenerDeltas(this, this.template, container, context, component, inputs, timelinesRunning, eventsFired, inputsChanged)
  return deltas
}

Template.prototype.deltas = function _deltas (context, component, container, inputs, timelinesRunning, eventsFired, inputsChanged, options) {
  var deltas = gatherDeltas(this, this.template, container, context, component, inputs, timelinesRunning, eventsFired, inputsChanged, options || {})
  return deltas
}

function accumulateEventHandlers (out, component) {
  var bytecode = component.bytecode.bytecode
  if (bytecode.eventHandlers) {
    for (var j = 0; j < bytecode.eventHandlers.length; j++) {
      var eventHandler = bytecode.eventHandlers[j]
      var eventSelector = eventHandler.selector
      var eventName = eventHandler.name
      var handler = eventHandler.handler
      if (!out[eventSelector]) out[eventSelector] = {}
      handler.__handler = true
      out[eventSelector][eventName] = handler
    }
  }
}

function accumulateControllerEventListeners (out, me) {
  if (me._controllerEventHandlers && me._controllerEventHandlers.length > 0) {
    for (var l = 0; l < me._controllerEventHandlers.length; l++) {
      var customHandler = me._controllerEventHandlers[l]
      if (!out[customHandler.selector]) out[customHandler.selector] = {}
      out[customHandler.selector][customHandler.event] = customHandler.handler
    }
  }
}

function applyAccumulatedResults (results, deltas, me, template, context, component) {
  for (var selector in results) {
    var matches = findMatchingElements(selector, template, me._matches)
    if (!matches || matches.length < 1) continue
    var group = results[selector]
    for (var j = 0; j < matches.length; j++) {
      var match = matches[j]
      var domId = match && match.attributes && match.attributes.id
      var haikuId = match && match.attributes && match.attributes[HAIKU_ID_ATTRIBUTE]
      var flexibleId = haikuId || domId
      if (deltas && flexibleId) deltas[flexibleId] = match
      if (group.transform) match.__transformed = true
      for (var key in group) {
        var value = group[key]
        if (value && value.__handler) applyHandlerToElement(match, key, value, context, component)
        else applyPropertyToElement(match, key, value, context, component)
      }
    }
  }
}

function gatherEventListenerDeltas (me, template, container, context, component, inputs, timelinesRunning, eventsFired, inputsChanged) {
  var deltas = {}
  var results = {}
  accumulateEventHandlers(results, component)
  accumulateControllerEventListeners(results, me)
  applyAccumulatedResults(results, deltas, me, template, context, component)
  return deltas
}

function gatherDeltas (me, template, container, context, component, inputs, timelinesRunning, eventsFired, inputsChanged, options) {
  var deltas = {}
  var results = {}
  var bytecode = component.bytecode.bytecode
  for (var i = 0; i < timelinesRunning.length; i++) {
    var timeline = timelinesRunning[i]
    var time = timeline.getBoundedTime()
    me.component.instance.builder.build(results, timeline.name, time, bytecode.timelines, true, inputs, eventsFired, inputsChanged)
  }
  initializeTreeAttributes(template, container) // handlers/vanities depend on attributes objects existing
  applyAccumulatedResults(results, deltas, me, template, context, component)
  if (options.sizing) _doSizing(template, container, options.sizing, deltas)
  // TODO: Calculating the tree layout should be skipped for already visited node
  // that we have already calculated among the descendants of the changed one
  for (var flexId in deltas) {
    var changedNode = deltas[flexId]
    calculateTreeLayouts(changedNode, changedNode.__parent, options)
  }
  return deltas
}

function applyContextChanges (component, inputs, template, container, me, context, options) {
  var results = {}
  accumulateEventHandlers(results, component)
  accumulateControllerEventListeners(results, me)
  var bytecode = component.bytecode.bytecode
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
      var time = timeline.getBoundedTime()
      me.component.instance.builder.build(results, timelineName, time, bytecode.timelines, false, inputs)
    }
  }
  initializeTreeAttributes(template, container) // handlers/vanities depend on attributes objects existing
  scopifyElements(template) // I think this only needs to happen once when we build the full tree
  applyAccumulatedResults(results, null, me, template, context, component)
  if (options.sizing) _doSizing(template, container, options.sizing)
  calculateTreeLayouts(template, container, options)
  return template
}

function _doSizing (element, container, mode, deltas) {
  if (mode === true) mode = 'contain'

  var elementWidth = element.layout.sizeAbsolute.x
  var elementHeight = element.layout.sizeAbsolute.y

  var containerWidth = container.layout.computed.size.x
  var containerHeight = container.layout.computed.size.y

  // I.e., the amount by which we'd have to multiply the element's scale to make it
  // exactly the same size as its container (without going above it)
  var scaleDiffX = containerWidth / elementWidth
  var scaleDiffY = containerHeight / elementHeight

  // This makes sure that the sizing occurs with respect to a correct and consistent origin point,
  // but only if the user didn't happen to explicitly set this value (we allow their override).
  if (!element.attributes.style['transform-origin']) {
    element.attributes.style['transform-origin'] = 'top left'
  }

  // IMPORTANT: If any value has been changed on the element, you must set this to true.
  // Otherwise the changed object won't go into the deltas dictionary, and the element won't update.
  var changed = false

  switch (mode) {
    // Make the base element its default scale, which is just a multiplier of one. This is the default.
    case 'normal':
      if (element.layout.scale.x !== 1.0) {
        changed = true
        element.layout.scale.x = 1.0
      }
      if (element.layout.scale.y !== 1.0) {
        changed = true
        element.layout.scale.y = 1.0
      }
      break

    // Stretch the element to fit the container on both x and y dimensions (distortion allowed)
    case 'stretch':
      if (scaleDiffX !== element.layout.scale.x) {
        changed = true
        element.layout.scale.x = scaleDiffX
      }
      if (scaleDiffY !== element.layout.scale.y) {
        changed = true
        element.layout.scale.y = scaleDiffY
      }
      break

    // CONTAIN algorithm
    // see https://developer.mozilla.org/en-US/docs/Web/CSS/background-size?v=example
    // A keyword that scales the image as large as possible and maintains image aspect ratio
    // (image doesn't get squished). Image is letterboxed within the container.
    // When the image and container have different dimensions, the empty areas (either top/bottom of left/right)
    // are filled with the background-color.
    case 'contain':
      var containScaleToUse = null

      // We're looking for the larger of the two scales that still allows both dimensions to fit in the box
      // The rounding is necessary to avoid precision issues, where we end up comparing e.g. 2.0000000000001 to 2
      if (~~(scaleDiffX * elementWidth) <= containerWidth && ~~(scaleDiffX * elementHeight) <= containerHeight) {
        containScaleToUse = scaleDiffX
      }
      if (~~(scaleDiffY * elementWidth) <= containerWidth && ~~(scaleDiffY * elementHeight) <= containerHeight) {
        if (containScaleToUse === null) {
          containScaleToUse = scaleDiffY
        } else {
          if (scaleDiffY >= containScaleToUse) {
            containScaleToUse = scaleDiffY
          }
        }
      }

      // We shouldn't ever be null here, but in case of a defect, show this warning
      if (containScaleToUse === null) {
        console.warn('[haiku player] unable to compute scale for contain sizing algorithm')
        return void (0)
      }

      changed = true // HACK: Unless we assume we changed, there seems to be an off-by-a-frame issue

      element.layout.scale.x = containScaleToUse
      element.layout.scale.y = containScaleToUse

      // Offset the translation so that the element remains centered within the letterboxing
      element.layout.translation.x = -((containScaleToUse * elementWidth) - containerWidth) / 2
      element.layout.translation.y = -((containScaleToUse * elementHeight) - containerHeight) / 2

      break

    // COVER algorithm (inverse of CONTAIN)
    // see https://developer.mozilla.org/en-US/docs/Web/CSS/background-size?v=example
    // A keyword that is the inverse of contain. Scales the image as large as possible and maintains
    // image aspect ratio (image doesn't get squished). The image "covers" the entire width or height
    // of the container. When the image and container have different dimensions, the image is clipped
    // either left/right or top/bottom.
    case 'cover':
      var coverScaleToUse = null

      // We're looking for the smaller of two scales that ensures the entire box is covered.
      // The rounding is necessary to avoid precision issues, where we end up comparing e.g. 2.0000000000001 to 2
      if (~~(scaleDiffX * elementWidth) >= containerWidth && ~~(scaleDiffX * elementHeight) >= containerHeight) {
        coverScaleToUse = scaleDiffX
      }
      if (~~(scaleDiffY * elementWidth) >= containerWidth && ~~(scaleDiffY * elementHeight) >= containerHeight) {
        if (coverScaleToUse === null) {
          coverScaleToUse = scaleDiffY
        } else {
          if (scaleDiffY <= coverScaleToUse) {
            coverScaleToUse = scaleDiffY
          }
        }
      }

      changed = true // HACK: Unless we assume we changed, there seems to be an off-by-a-frame issue

      element.layout.scale.x = coverScaleToUse
      element.layout.scale.y = coverScaleToUse

      // Offset the translation so that the element remains centered within the letterboxing
      element.layout.translation.x = -((coverScaleToUse * elementWidth) - containerWidth) / 2
      element.layout.translation.y = -((coverScaleToUse * elementHeight) - containerHeight) / 2

      break
  }

  if (changed && deltas) {
    // Part of the render/update system involves populating a dictionary of per-element updates,
    // which explains why instead of returning a value here, we assign the updated element.
    // The 'deltas' dictionary is passed to us from the render functions upstream of here.
    deltas[element.attributes[HAIKU_ID_ATTRIBUTE]] = element
  }
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
    var copy = shallowClone(element)
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
  clone.__parent = element.__parent
  clone.__scope = element.__scope
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
  if (Component.isBytecode(something)) instance = new Component(something, context.component.options, { internal: true })
  if (Component.isComponent(something)) instance = something
  instance.attributes = instance.props = element.attributes
  instance.children = instance.surrogates = element.children
  instance.context = context // Hack: Important
  instance.startTimeline(Timeline.DEFAULT_NAME) // Ensure we cue up timelines
  return instance
}

function findMatchingElements (selector, template, cache) {
  if (cache[selector]) return cache[selector]
  var matches = queryTree([], template, selector, CSS_QUERY_MAPPING)
  cache[selector] = matches
  return matches
}

function calculateTreeLayouts (tree, container, options) {
  if (!tree || typeof tree === 'string') return
  calculateNodeLayout(tree, container, options)
  if (!tree.children) return
  if (tree.children.length < 1) return
  for (var i = 0; i < tree.children.length; i++) calculateTreeLayouts(tree.children[i], tree, options)
}

function calculateNodeLayout (element, parent, options) {
  if (parent) {
    var parentSize = parent.layout.computed.size
    var computedLayout = Layout3D.computeLayout({}, element.layout, element.layout.matrix, IDENTITY_MATRIX, parentSize)
    if (computedLayout === false) { // False indicates 'don't show
      element.layout.computed = { invisible: true, size: parentSize || { x: 0, y: 0, z: 0 } }
    } else {
      element.layout.computed = computedLayout || { size: parentSize } // Need to pass some size to children, so if this element doesn't have one, use the parent's
    }
  }
}

function applyPropertyToElement (element, name, value, context, component) {
  if (vanityHandlers[element.elementName] && vanityHandlers[element.elementName][name]) {
    vanityHandlers[element.elementName][name](name, element, value, context, component)
  } else {
    element.attributes[name] = value
  }
}

function applyHandlerToElement (match, name, fn, context, component) {
  if (!match.__handlers) match.__handlers = {}
  match.__handlers[name] = fn
  return match
}

module.exports = Template
