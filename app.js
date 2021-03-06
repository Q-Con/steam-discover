// https://codingrange.com/blog/steam-in-home-streaming-discovery-protocol
// https://www.npmjs.com/package/protocol-buffers
// https://github.com/SteamRE/SteamKit/blob/master/Resources/Protobufs/steamclient/steammessages_remoteclient_discovery.proto
// https://developer.valvesoftware.com/wiki/Steam_Web_API#GetPlayerSummaries_.28v0001.29

// OS types (as seen in broadcast packets:
// 10: win 7
// 16: win 10???
// 18446744069414584000: osx 10.10 (yosemite) (smells like an int/floatingpoint/overflow/something)

var listener = require("./listener.js"),
    steam =  require("./betterSteamWrapper.js"), //require("./steamapiwrapper"), 
    fs = require("fs"),
    querybuffer = require('./querybuffer.js'),
    sinkWrapper = require('./sinkWrapper.js');

var config = require("./config.json");
config['data-sinks'] = config['data-sinks'] || [];

// Backwards compatibility for the old config file format
if (config.recordAllDataInPostgres && config.postgresConnectionString) {
    if (config['data-sinks'].filter((s) => { return s.type == 'postgres' && s.enabled == true}).length == 0)
    {
        config['data-sinks'].push({
            type: "postgres",
            enabled: true,
            options: {
                connectionString: config.postgresConnectionString
            }
        });
    }
}
if (config.enableRedisUpdatePublishing) {
  if (config['data-sinks'].filter((s) => { return s.type == 'redis' && s.enabled == true}).length == 0)
    {
        config['data-sinks'].push({
            type: "redis",
            enabled: true,
            options: {
                connectionString: config.redisConnectionString
            }
        });
    }
}

var sinker = new sinkWrapper(config["data-sinks"], config["excludeFields"]);
console.log(sinker);
if (!config.steamApiKey) {
  throw "steamApiKey must be set in config";
}
if (sinker.hasSinks() == 0) {
  throw "No data sinks set in config file, nothing for this app to do! :(";
}

var interval = (config.broadcastIntervalSeconds || 30) * 1000,
    batchId = 1,
    debug = !!config.enableDebugConsoleMessages,
    apiKey = config.steamApiKey;

var steamApiWrapper = new steam(apiKey);

var qb = new querybuffer(interval, (items) => {
  var thisBatch = batchId++;

  if (Array.isArray(items)) {
    var ids  = items.map((p) => {return p.users[0].steamid;});
    ids = getUnique(ids);

    console.log("!!!! Querying steam API for: ", ids.length);

    steamApiWrapper.getBulkPlayerInfo(ids, function(err,p) {
      if (err) { return console.error(err); }
      sinker.insertAccount(p, thisBatch)
      
      if (p.gameextrainfo) {
        var extraInfo = ` playing game '${p.gameextrainfo}'`;
      }

      console.log(`Saw steam user ${p.personaname}${extraInfo||''}`);
    });
  }
});

var l = listener.create({port: 27036, ip: "0.0.0.0"} );
l.on("client_seen", function(d) {
  sinker.insertClient(d, batchId);
  qb.addItem(d);
});


l.on("connected", () => {
  setInterval( () => {
    l.broadcastDiscovery();
  }, interval);
  l.broadcastDiscovery();
});

function getUnique (arr) {
  var seen = {};
  var ret = [];

  arr.filter(function(item) {
    if (!seen[item]) {
      ret.push(item);
      seen[item] = true;
    }
  });
  return ret;
}

if (debug) {
  l.on("raw_message", function(m) {
    var rinfo = m.sender;
    console.log(`got message from ${rinfo.address}:${rinfo.port}`);
  });
  l.on("invalid_packet", function(d) { 
      console.log("Invalid packet, reason: " + d.reason);
  });
}
