"use strict";

var request = require("request");
var http = require("http");
var querystring = require("querystring");
var xml2js = require('xml2js');

var FEED_URL = "https://spreadsheets.google.com/feeds/";
var CHAR_KEY = xml2js.defaults["0.2"].charkey;
var ATTR_KEY = xml2js.defaults["0.2"].attrkey;

var Spreadsheets;

var forceArray = function(val) {
  if(Array.isArray(val)) {
    return val;
  }

  return [val];
};

var getFeed = function(params, auth, query, cb) {
  var headers = {};
  var visibility = "public";
  var projection = "values";

  if(auth) {
    headers.Authorization = "GoogleLogin auth=" + auth;
    visibility = "private";
    projection = "full";
  }
  params.push(visibility, projection);

  query = query || {};

  var url = FEED_URL + params.join("/");
  if(query && Object.keys(query).length !== 0) {
    url += "?" + querystring.stringify(query);
  }

  request.get({
    url: url,
    headers: headers,
  }, function(err, response, body) {
    if(err) {
      cb(err);
      return;
    }

    if(!response) {
      cb(new Error("Missing response."));
      return;
    }

    if(response.statusCode === 401) {
      return cb(new Error("Invalid authorization key."));
    }

    if(response.statusCode >= 400) {
      return cb(new Error("HTTP error " + response.statusCode + ": " + http.STATUS_CODES[response.statusCode]));
    }

    var parser = new xml2js.Parser({explicitArray: false});
  	parser.parseString(body, function (err, result) {
      cb(null, result.feed);
  	});
  });
};

var Worksheet = function(spreadsheet, data) {
  // This should be okay, unless Google decided to change their URL scheme...
  var id = data.id;
  this.id = id.substring(id.lastIndexOf("/") + 1);
  this.spreadsheet = spreadsheet;
  this.rowCount = data["gs:rowCount"];
  this.colCount = data["gs:colCount"];
  this.title = data.title[CHAR_KEY];
};

function prepareRowsOrCellsOpts(worksheet, opts) {
  opts = opts || {};
  opts.key = worksheet.spreadsheet.key;
  opts.auth = worksheet.spreadsheet.auth;
  opts.worksheet = worksheet.id;
  return opts;
}

Worksheet.prototype.rows = function(opts, cb) {
  Spreadsheets.rows(prepareRowsOrCellsOpts(this, opts), cb);
};

Worksheet.prototype.cells = function(opts, cb) {
  Spreadsheets.cells(prepareRowsOrCellsOpts(this, opts), cb);
};

var Spreadsheet = function(key, auth, data) {
  this.key = key;
  this.auth = auth;
  this.title = data.title[CHAR_KEY];
  this.updated = data.updated;
  this.author = {
    name: data.author.name,
    email: data.author.email
  };

  this.worksheets = [];
  var worksheets = forceArray(data.entry);

  worksheets.forEach(function(worksheetData) {
    this.worksheets.push(new Worksheet(this, worksheetData));
  }, this);
};

var Row = function(data) {
  Object.keys(data).forEach(function(key) {
    var val;
    val = data[key];
    if(key.substring(0, 4) === "gsx:")  {
      if(typeof val === 'object' && Object.keys(val).length === 0) {
        val = null;
      }
      if (key === "gsx:") {
        this[key.substring(0, 3)] = val;
      } else {
        this[key.substring(4)] = val;
      }
    } else if(key.substring(0, 4) === "gsx$") {
      if (key === "gsx$") {
        this[key.substring(0, 3)] = val;
      } else {
        this[key.substring(4)] = val.$t || val;
      }
    } else {
      if (key === "id") {
        this[key] = val;
      } else if (val.$t) {
        this[key] = val.$t;
      }
    }
  }, this);
};

var Cells = function(data) {
  // Populate the cell data into an array grid.
  this.cells = {};

  var entries = forceArray(data.entry);
  var cell, row, col;
  entries.forEach(function(entry) {
    cell = entry["gs:cell"];
    row = cell[ATTR_KEY].row;
    col = cell[ATTR_KEY].col;

    if(!this.cells[row]) {
      this.cells[row] = {};
    }

    this.cells[row][col] = {
      row: row,
      col: col,
      value: cell[CHAR_KEY] || ""
    };
  }, this);
};

Spreadsheets = module.exports = function(opts, cb) {
  if(!opts) {
    throw new Error("Invalid arguments.");
  }
  if(!opts.key) {
    throw new Error("Spreadsheet key not provided.");
  }

  getFeed(["worksheets", opts.key], opts.auth, null, function(err, data) {
    if(err) {
      return cb(err);
    }

    cb(null, new Spreadsheet(opts.key, opts.auth, data));
  });
};

Spreadsheets.rows = function(opts, cb) {
  if(!opts) {
    throw new Error("Invalid arguments.");
  }
  if(!opts.key) {
    throw new Error("Spreadsheet key not provided.");
  }
  if(!opts.worksheet) {
    throw new Error("Worksheet not specified.");
  }

  var query = {};
  if(opts.start) {
    query["start-index"] = opts.start;
  }
  if(opts.num) {
    query["max-results"] = opts.num;
  }
  if(opts.orderby) {
    query.orderby = opts.orderby;
  }
  if(opts.reverse) {
    query.reverse = opts.reverse;
  }
  if(opts.sq) {
    query.sq = opts.sq;
  }

  getFeed(["list", opts.key, opts.worksheet], opts.auth, query, function(err, data) {
    if(err) {
      return cb(err);
    }

    var rows = [];

    if(typeof data.entry !== "undefined" && data.entry !== null) {
      var entries = forceArray(data.entry);

      entries.forEach(function(entry) {
        rows.push(new Row(entry));
      });
    }

    cb(null, rows);
  });
};

Spreadsheets.cells = function(opts, cb) {
  if(!opts) {
    throw new Error("Invalid arguments.");
  }
  if(!opts.key) {
    throw new Error("Spreadsheet key not provided.");
  }
  if(!opts.worksheet) {
    throw new Error("Worksheet not specified.");
  }

  var query = {
  };
  if(opts.range) {
    query.range = opts.range;
  }
  if (opts.maxRow) {
    query["max-row"] = opts.maxRow;
  }
  if (opts.minRow) {
    query["min-row"] = opts.minRow;
  }
  if (opts.maxCol) {
    query["max-col"] = opts.maxCol;
  }
  if (opts.minCol) {
    query["min-col"] = opts.minCol;
  }

  getFeed(["cells", opts.key, opts.worksheet], opts.auth, query, function(err, data) {
    if(err) {
      return cb(err);
    }

    if(typeof data.entry !== "undefined" && data.entry !== null) {
      return cb(null, new Cells(data));
    } else {
      return cb(null, { cells: {} }); // Not entirely happy about defining the data format in 2 places (here and in Cells()), but the alternative is moving this check for undefined into that constructor, which means it's in a different place than the one for .rows() above -- and that mismatch is what led to it being missed
    }
  });
};
