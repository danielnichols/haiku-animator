/** This file was autogenerated by Haiku at 20170716095407. */
var code = require('./code')
var adapter = window.HaikuPlayer && window.HaikuPlayer['2.1.15']
if (adapter) {
  module.exports = adapter(code)
} else  {
  function safety () {
    console.error(
      '[haiku player] player version 2.1.15 seems to be missing. ' +
      'index.embed.js expects it at window.HaikuPlayer["2.1.15"], but we cannot find it. ' +
      'you may need to add a <script src="path/to/HaikuPlayer.js"></script> to fix this. ' +
      'if you really need to load the player after this script, you could try: ' +
      'myHaikuPlayer(HaikuComponentEmbed_zack3_SuperComplex)(document.getElementById("myMountElement"))'
    )
    return code
  }
  for (var key in code) {
    safety[key] = code[key]
  }
  module.exports = safety
}