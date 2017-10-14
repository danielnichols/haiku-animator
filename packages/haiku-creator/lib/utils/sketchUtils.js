'use strict';

var _require = require('./fileManipulation'),
    _download = _require.download,
    unzip = _require.unzip;

var fs = require('fs');
var os = require('os');

var DOWNLOAD_URL = 'https://download.sketchapp.com/sketch.zip';

module.exports = {
  download: function download(progressCallback, shouldCancel) {
    return new Promise(function (resolve, reject) {
      var tempPath = os.tmpdir();
      var zipPath = tempPath + '/sketch.zip';
      var installationPath = '/Applications';

      _download(DOWNLOAD_URL, zipPath, progressCallback, shouldCancel).then(function () {
        return unzip(zipPath, installationPath, 'Sketch');
      }).then(resolve).catch(reject);
    });
  },
  checkIfInstalled: function checkIfInstalled() {
    return new Promise(function (resolve, reject) {
      fs.access('/Applications/Sketch.app', fs.constants.F_OK, function (err) {
        if (err) resolve(false);
        resolve(true);
      });
    });
  }
};
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy91dGlscy9za2V0Y2hVdGlscy5qcyJdLCJuYW1lcyI6WyJyZXF1aXJlIiwiZG93bmxvYWQiLCJ1bnppcCIsImZzIiwib3MiLCJET1dOTE9BRF9VUkwiLCJtb2R1bGUiLCJleHBvcnRzIiwicHJvZ3Jlc3NDYWxsYmFjayIsInNob3VsZENhbmNlbCIsIlByb21pc2UiLCJyZXNvbHZlIiwicmVqZWN0IiwidGVtcFBhdGgiLCJ0bXBkaXIiLCJ6aXBQYXRoIiwiaW5zdGFsbGF0aW9uUGF0aCIsInRoZW4iLCJjYXRjaCIsImNoZWNrSWZJbnN0YWxsZWQiLCJhY2Nlc3MiLCJjb25zdGFudHMiLCJGX09LIiwiZXJyIl0sIm1hcHBpbmdzIjoiOztlQUEwQkEsUUFBUSxvQkFBUixDO0lBQW5CQyxTLFlBQUFBLFE7SUFBVUMsSyxZQUFBQSxLOztBQUNqQixJQUFNQyxLQUFLSCxRQUFRLElBQVIsQ0FBWDtBQUNBLElBQU1JLEtBQUtKLFFBQVEsSUFBUixDQUFYOztBQUVBLElBQU1LLGVBQWUsMkNBQXJCOztBQUVBQyxPQUFPQyxPQUFQLEdBQWlCO0FBQ2ZOLFVBRGUsb0JBQ0xPLGdCQURLLEVBQ2FDLFlBRGIsRUFDMkI7QUFDeEMsV0FBTyxJQUFJQyxPQUFKLENBQVksVUFBQ0MsT0FBRCxFQUFVQyxNQUFWLEVBQXFCO0FBQ3RDLFVBQU1DLFdBQVdULEdBQUdVLE1BQUgsRUFBakI7QUFDQSxVQUFNQyxVQUFhRixRQUFiLGdCQUFOO0FBQ0EsVUFBTUcsbUJBQW1CLGVBQXpCOztBQUVBZixnQkFBU0ksWUFBVCxFQUF1QlUsT0FBdkIsRUFBZ0NQLGdCQUFoQyxFQUFrREMsWUFBbEQsRUFDR1EsSUFESCxDQUNRLFlBQU07QUFDVixlQUFPZixNQUFNYSxPQUFOLEVBQWVDLGdCQUFmLEVBQWlDLFFBQWpDLENBQVA7QUFDRCxPQUhILEVBSUdDLElBSkgsQ0FJUU4sT0FKUixFQUtHTyxLQUxILENBS1NOLE1BTFQ7QUFNRCxLQVhNLENBQVA7QUFZRCxHQWRjO0FBZ0JmTyxrQkFoQmUsOEJBZ0JLO0FBQ2xCLFdBQU8sSUFBSVQsT0FBSixDQUFZLFVBQUNDLE9BQUQsRUFBVUMsTUFBVixFQUFxQjtBQUN0Q1QsU0FBR2lCLE1BQUgsQ0FBVSwwQkFBVixFQUFzQ2pCLEdBQUdrQixTQUFILENBQWFDLElBQW5ELEVBQXlELFVBQUNDLEdBQUQsRUFBUztBQUNoRSxZQUFJQSxHQUFKLEVBQVNaLFFBQVEsS0FBUjtBQUNUQSxnQkFBUSxJQUFSO0FBQ0QsT0FIRDtBQUlELEtBTE0sQ0FBUDtBQU1EO0FBdkJjLENBQWpCIiwiZmlsZSI6InNrZXRjaFV0aWxzLmpzIiwic291cmNlc0NvbnRlbnQiOlsiY29uc3Qge2Rvd25sb2FkLCB1bnppcH0gPSByZXF1aXJlKCcuL2ZpbGVNYW5pcHVsYXRpb24nKVxuY29uc3QgZnMgPSByZXF1aXJlKCdmcycpXG5jb25zdCBvcyA9IHJlcXVpcmUoJ29zJylcblxuY29uc3QgRE9XTkxPQURfVVJMID0gJ2h0dHBzOi8vZG93bmxvYWQuc2tldGNoYXBwLmNvbS9za2V0Y2guemlwJ1xuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgZG93bmxvYWQgKHByb2dyZXNzQ2FsbGJhY2ssIHNob3VsZENhbmNlbCkge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBjb25zdCB0ZW1wUGF0aCA9IG9zLnRtcGRpcigpXG4gICAgICBjb25zdCB6aXBQYXRoID0gYCR7dGVtcFBhdGh9L3NrZXRjaC56aXBgXG4gICAgICBjb25zdCBpbnN0YWxsYXRpb25QYXRoID0gJy9BcHBsaWNhdGlvbnMnXG5cbiAgICAgIGRvd25sb2FkKERPV05MT0FEX1VSTCwgemlwUGF0aCwgcHJvZ3Jlc3NDYWxsYmFjaywgc2hvdWxkQ2FuY2VsKVxuICAgICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgICAgcmV0dXJuIHVuemlwKHppcFBhdGgsIGluc3RhbGxhdGlvblBhdGgsICdTa2V0Y2gnKVxuICAgICAgICB9KVxuICAgICAgICAudGhlbihyZXNvbHZlKVxuICAgICAgICAuY2F0Y2gocmVqZWN0KVxuICAgIH0pXG4gIH0sXG5cbiAgY2hlY2tJZkluc3RhbGxlZCAoKSB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGZzLmFjY2VzcygnL0FwcGxpY2F0aW9ucy9Ta2V0Y2guYXBwJywgZnMuY29uc3RhbnRzLkZfT0ssIChlcnIpID0+IHtcbiAgICAgICAgaWYgKGVycikgcmVzb2x2ZShmYWxzZSlcbiAgICAgICAgcmVzb2x2ZSh0cnVlKVxuICAgICAgfSlcbiAgICB9KVxuICB9XG59XG4iXX0=