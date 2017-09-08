let xmlToMana = require("./xmlToMana")
let visitManaTree = require("./visitManaTree")

let STRING_TYPE = "string"

/**
 * @method upgradeBytecodeInPlace
 * @description Mechanism to modify our bytecode from legacy format to the current format.
 * Think of this like a migration that always runs in production components just in case we
 * get something that happens to be legacy.
 */
function upgradeBytecodeInPlace(bytecode, options) {
  if (!bytecode.states) {
    bytecode.states = {}
  }

  // Convert the properties array to the states dictionary
  if (bytecode.properties) {
    // console.info('[haiku player] auto-upgrading code properties array to states object (2.1.14+)')
    let properties = bytecode.properties
    delete bytecode.properties
    for (let i = 0; i < properties.length; i++) {
      let propertySpec = properties[i]
      let updatedSpec = {}
      if (propertySpec.value !== undefined) updatedSpec.value = propertySpec.value
      if (propertySpec.type !== undefined) updatedSpec.type = propertySpec.type
      if (propertySpec.setter !== undefined) updatedSpec.set = propertySpec.setter
      if (propertySpec.getter !== undefined) updatedSpec.get = propertySpec.getter
      if (propertySpec.set !== undefined) updatedSpec.set = propertySpec.set
      if (propertySpec.get !== undefined) updatedSpec.get = propertySpec.get
      bytecode.states[propertySpec.name] = updatedSpec
    }
  }

  // Convert the eventHandlers array into a dictionary
  // [{selector:'foo',name:'onclick',handler:function}] => {'foo':{'onclick':{handler:function}}}
  if (Array.isArray(bytecode.eventHandlers)) {
    // console.info('[haiku player] auto-upgrading code event handlers to object format (2.1.14+)')
    let eventHandlers = bytecode.eventHandlers
    delete bytecode.eventHandlers
    bytecode.eventHandlers = {}
    for (let j = 0; j < eventHandlers.length; j++) {
      let eventHandlerSpec = eventHandlers[j]
      if (!bytecode.eventHandlers[eventHandlerSpec.selector]) bytecode.eventHandlers[eventHandlerSpec.selector] = {}
      bytecode.eventHandlers[eventHandlerSpec.selector][eventHandlerSpec.name] = {
        handler: eventHandlerSpec.handler,
      }
    }
  }

  // Convert a string template into our internal object format
  if (typeof bytecode.template === STRING_TYPE) {
    // console.info('[haiku player] auto-upgrading template string to object format (2.0.0+)')
    bytecode.template = xmlToMana(bytecode.template)
  }

  // If specified, make sure that internal URL references, e.g. url(#my-filter), are unique
  // per each component instance, otherwise we will get filter collisions and weirdness on the page
  if (options && options.referenceUniqueness) {
    let referencesToUpdate = {}
    let alreadyUpdatedReferences = {}
    if (bytecode.template) {
      visitManaTree("0", bytecode.template, function _visitor(elementName, attributes, children, node) {
        if (elementName === "filter") {
          if (attributes.id && !alreadyUpdatedReferences[attributes.id]) {
            let prev = attributes.id
            let next = prev + "-" + options.referenceUniqueness
            attributes.id = next
            referencesToUpdate["url(#" + prev + ")"] = "url(#" + next + ")"
            alreadyUpdatedReferences[attributes.id] = true
          }
        }
      }, null, 0)
    }
    if (bytecode.timelines) {
      for (let timelineName in bytecode.timelines) {
        for (let selector in bytecode.timelines[timelineName]) {
          for (let propertyName in bytecode.timelines[timelineName][selector]) {
            // Don't proceed if we aren't dealing with a filter attribute
            if (propertyName !== "filter") {
              continue
            }
            for (let keyframeMs in bytecode.timelines[timelineName][selector][propertyName]) {
              let keyframeDesc = bytecode.timelines[timelineName][selector][propertyName][keyframeMs]
              if (keyframeDesc && referencesToUpdate[keyframeDesc.value]) {
                // console.info('[haiku player] changing filter url reference ' + keyframeDesc.value + ' to ' + referencesToUpdate[keyframeDesc.value])
                keyframeDesc.value = referencesToUpdate[keyframeDesc.value]
              }
            }
          }
        }
      }
    }
  }

  // What else?
}

module.exports = upgradeBytecodeInPlace
