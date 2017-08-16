/**
 * Copyright (c) Haiku 2016-2017. All rights reserved.
 */

var applyLayout = require('./applyLayout')
var assignAttributes = require('./assignAttributes')
var getTypeAsString = require('./getTypeAsString')

var OBJECT = 'object'

function updateElement (
  domElement,
  virtualElement,
  parentNode,
  parentVirtualElement,
  locator,
  context,
  isPatchOperation
) {
  // If a text node, go straight to 'replace' since we don't know the tag name
  if (isTextNode(virtualElement, context)) {
    replaceElementWithText(domElement, virtualElement, context)
    return virtualElement
  }

  if (!domElement.haiku) domElement.haiku = {}

  var domTagName = domElement.tagName.toLowerCase().trim()
  var elName = normalizeName(getTypeAsString(virtualElement))
  var virtualElementTagName = elName.toLowerCase().trim()
  var incomingKey =
    virtualElement.key ||
    (virtualElement.attributes && virtualElement.attributes.key)
  var existingKey = domElement.haiku && domElement.haiku.key
  var isKeyDifferent =
    incomingKey !== null &&
    incomingKey !== undefined &&
    incomingKey !== existingKey

  // For so-called 'horizon' elements, we assume that we've ceded control to another renderer,
  // so the most we want to do is update the attributes and layout properties, but leave the rest alone
  if (!context._isHorizonElement(virtualElement)) {
    if (domTagName !== virtualElementTagName) {
      return replaceElement(
        domElement,
        virtualElement,
        parentNode,
        parentVirtualElement,
        locator,
        context
      )
    }

    if (isKeyDifferent) {
      return replaceElement(
        domElement,
        virtualElement,
        parentNode,
        parentVirtualElement,
        locator,
        context
      )
    }
  }

  if (
    virtualElement.attributes &&
    typeof virtualElement.attributes === OBJECT
  ) {
    assignAttributes(
      domElement,
      virtualElement,
      context,
      isPatchOperation,
      isKeyDifferent
    )
  }
  applyLayout(
    domElement,
    virtualElement,
    parentNode,
    parentVirtualElement,
    context,
    isPatchOperation,
    isKeyDifferent
  )
  if (incomingKey !== undefined && incomingKey !== null) {
    domElement.haiku.key = incomingKey
  }

  if (Array.isArray(virtualElement.children)) {
    renderTree(
      domElement,
      virtualElement,
      virtualElement.children,
      locator,
      context,
      isPatchOperation
    )
  } else if (!virtualElement.children) {
    // In case of falsy virtual children, we still need to remove elements that were already there
    renderTree(
      domElement,
      virtualElement,
      [],
      locator,
      context,
      isPatchOperation
    )
  }

  return domElement
}

module.exports = updateElement

var renderTree = require('./renderTree')
var replaceElementWithText = require('./replaceElementWithText')
var replaceElement = require('./replaceElement')
var normalizeName = require('./normalizeName')
var isTextNode = require('./isTextNode')
