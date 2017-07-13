/**
 * Copyright (c) Haiku 2016-2017. All rights reserved.
 */

var normalizeName = require('./normalizeName')
var getTypeAsString = require('./getTypeAsString')

var SVG_EL_NAMES = require('./../../helpers/allSvgElementNames')

function createTagNode (
  domElement,
  virtualElement,
  parentVirtualElement,
  locator,
  hash,
  options,
  scopes
) {
  var tagName = normalizeName(getTypeAsString(virtualElement))
  var newDomElement
  if (SVG_EL_NAMES[tagName]) {
    // SVG
    newDomElement = createSvgElement(domElement, tagName, options, scopes)
  } else {
    // Normal DOM
    newDomElement = domElement.ownerDocument.createElement(tagName)
  }

  // This doesn't happen in renderTree because the element doesn't exist yet.
  if (!newDomElement.haiku) newDomElement.haiku = {}
  newDomElement.haiku.locator = locator
  if (!options.cache[newDomElement.haiku.locator]) {
    options.cache[newDomElement.haiku.locator] = {}
  }

  var incomingKey =
    virtualElement.key ||
    (virtualElement.attributes && virtualElement.attributes.key)
  if (incomingKey !== undefined && incomingKey !== null) {
    newDomElement.haiku.key = incomingKey
  }

  // epdateElement recurses down into setAttributes, etc.
  updateElement(
    newDomElement,
    virtualElement,
    domElement,
    parentVirtualElement,
    locator,
    hash,
    options,
    scopes
  )
  return newDomElement
}

module.exports = createTagNode

var createSvgElement = require('./createSvgElement')
var updateElement = require('./updateElement')
