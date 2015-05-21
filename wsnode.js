#!/usr/bin/env node
var fs = require('fs');
var http = require('http');
var express = require('express');
var app = express();
var server = http.Server(app);
var node_path = require('path');
var node_url = require('url');
var _=require("underscore");

var WebSocketServer = require('websocket').server;

/*******

set up http

*******/
app.get('/user/:id', function(req, res){
    //console.log(req.app);
    res.send('user ' + req.params.id);
});

app.use(express.static(node_path.join(__dirname, './'))); //  "public" off of current is root

server.listen(8080);



/*******

set up mongodb

*******/



var db;
var col;

var MongoClient = require('mongodb').MongoClient;
var ObjectID = require('mongodb').ObjectID;
var assert = require('assert');

// Connection URL
var url = 'mongodb://127.0.0.1:15017/testEmail';
// Use connect method to connect to the Server
MongoClient.connect(url, function(err, db_instance) {
  assert.equal(null, err);
  console.log("Connected correctly to mongodb server");
  db = db_instance;
});



/*******

set up websockets

*******/


var clients=[];

wsServer = new WebSocketServer({
    httpServer: server,
    maxReceivedFrameSize : 1024*1024*1,
    autoAcceptConnections: false
});

function originIsAllowed(origin) {
  // put logic here to detect whether the specified origin is allowed.
  return true;
}

function closeClient(ws){
  if(ws.connected) ws.close();
  var pos = _.indexOf(clients, ws);
  if(pos>-1) clients.splice(pos,1 );
}

wsServer.on("connect", function(wsCon){
	console.log("connected", new Date() );
});
wsServer.on("close", function(wsCon, closeReason, description){
	console.log("closed:", new Date, closeReason, description);
});


wsServer.on('request', requestFunc);
function requestFunc(request) {
    //console.log(request.resourceURL);
    var link = request.resourceURL.href;
    var path = request.resourceURL.pathname;
    var domain = request.requestedProtocols.join(",");
    var param = ( node_url.parse(link, true).query );
    var ws;
    console.log( "new request link: ", link );
    /* check for if origin is allowed */
    if (!originIsAllowed(request.origin)) {
      // Make sure we only accept requests from an allowed origin
      request.reject();
      console.log((new Date()) + ' Connection from origin ' + request.origin + ' rejected.');
      return;
    }

    /* check for param is right */
    if(!param.q || !param.uid ){
      console.log(' url is wrong. now exit.', param);
      return;
    }

    var keyword = encodeURIComponent(param.q);
    col = db.collection( 'q.'+keyword );
    console.log('q.'+keyword);

      /* check for keyword is already exist */
      if( _.where(clients, {q: param.q} ).length >=1 ){
        console.log(clients.length, "already has same keyword ws:", param.q ," now exit. uid:", param.uid );
        return;
      }

      /* accept and get connection object: ws */
      ws = request.accept(domain, request.origin);  //Websocket Connection Object
      
      
      /* init ws connect */
      ws.uid = param.uid;
      ws.q = param.q;
      ws.link = param.link;
      clients.push( ws );
  



    ws.sendObj=function(data){
      this.sendUTF( typeof data=="string" ? data : JSON.stringify( data ),  function ack(error) { if(error) console.log("SEND ERRRRRR!!!!! ", error); } );
    }

    ws.on('close', function(reasonCode, description) {
        closeClient(ws);
        console.log((new Date()) + ' Peer ' + ws.remoteAddress + ' disconnected. uid:', ws.uid,  " ERRRR!!!!!!! reason:", reasonCode, description);
        if(reasonCode==1006){
          console.log("waiting for reconnect");
          return;
        }
    });

    console.log(new Date(), 'connection successful！ total client:', clients.length, path, domain, ws.uid );    

    ws.on('message', function(message) {
        //console.log(request, path, domain, param);

      var thisws = this;
      var data;
      if (message.type === 'utf8') {
          data = message.utf8Data;
      }

      if(!data || !db) return;

      var ret = '';
      var msg = data[0]=='{' ? JSON.parse(data) : {} ;

      switch(msg.action){
        case "init":
          col.update({ keyword: keyword }, { keyword: keyword  , date: new Date(), slink:msg.slink } , {upsert:true, w: 1}, function(err, result) {  });
          break;

        case "discover":
          
          if( msg.q != keyword ) {
            console.log("keyword not match: ", msg.q );
            return;
          }
          
          var timeout = new Date();
          timeout.setHours( timeout.getHours() - 24*7 );  //time out 1 day

          col.find({ link: msg.link,   $or:[{"snapshot.status":"new"}, { "snapshot.date": {$gt: timeout} }]  }, {limit:5}).count(function(err, count){
            console.log("found available: ", count);
            if(!count){
              col.update(
                { link: msg.link }, 
                {   $set:{link: msg.link}, 
                  $addToSet: {snapshot: {status:'new', search_idx: msg.idx, title: msg.title, desc:msg.desc, date:new Date(), history_id:0, email:"", html:"", text:""} }
                }, 
                {upsert:true, w:1}, 
                function(err, r){ 
                  if(err)console.log(err); 
                  var cursor = col.aggregate(
                    [ { $match:{ link:msg.link}}, {$group: {_id:null, count:{$sum: { $size:"$snapshot" } } } }],
                    {cursor: {batchSize:1} }
                  );
                  cursor.toArray(function(err, docs){
                    if(docs.length<1)return;
                    console.log( docs[0].count );
                    col.update( { link:msg.link,"snapshot.status":"new" }, { $set:{ "snapshot.$.history_id": docs[0].count } } );
                  });
                }
              );
              
              thisws.sendObj( _.extend(msg, {status:"insert"} ));
            }else{
              thisws.sendObj( _.extend(msg, {status:"exists"} ));
            }
          });

          

          break;


        case "get_new_slot":
          console.log(msg.link);
          col.find({ link: msg.link, "snapshot.status":"new" }, {limit:5}).toArray(function(err, docs){
            var count = docs.length;
            console.log("New Slot Total matches: "+ count);
            var ids = _.map( docs, function(v,i){
              return v._id.toString();
            });

            thisws.sendObj( _.extend(msg, {total: count, o_ids: ids  } ));
          });
          break;
        case "update_email":
          var o_id = new ObjectID(msg.o_id);
          col.update({'_id': o_id, "snapshot.status":"new"}, { $set:{"snapshot.$.status":"ok", "snapshot.$.date":new Date(),  "snapshot.$.email":msg.email, "snapshot.$.html":msg.html , "snapshot.$.text":msg.text  , "snapshot.$.image":msg.image }}, function(){
            console.log( "updated email: email ", msg.email, " ,oid ", o_id );
            thisws.sendObj( _.extend(msg, {msg: "updated email & html. ", o_id: o_id  } ));
          } );
          break;


        case "timeout":
          col.find({ link: msg.link, "snapshot.status":"new" }, {limit:5}).toArray(function(err, docs){
            var count = docs.length;
            console.log("Timeout Total matches: "+ count);
            var ids = _.map( docs, function(v,i){
              return v._id.toString();
            });

            if(count){
              var o_id = new ObjectID(ids[0]);
              col.update({'_id': o_id, "snapshot.status":"new"}, { $set:{"snapshot.$.status":"timeout", "snapshot.$.date":new Date() }}, function(){
                console.log( "link timeout: ", msg.link, " ,oid ",  o_id );
                thisws.sendObj( _.extend(msg, {msg: "link timeout. ", link: msg.link, o_id:o_id  } ));
              } );
            }
          }) ;

          break;


        case "refused":
          col.find({ link: msg.link, "snapshot.status":"new" }, {limit:5}).toArray(function(err, docs){
            var count = docs.length;
            console.log("Refused Total matches: "+ count);
            var ids = _.map( docs, function(v,i){
              return v._id.toString();
            });

            if(count){
              var o_id = new ObjectID(ids[0]);
              col.update({'_id': o_id, "snapshot.status":"new"}, { $set:{"snapshot.$.status":"refused", "snapshot.$.date":new Date(), "snapshot.$.reason": msg.reason }}, function(){
                console.log( "link refused: ", msg.link, " ,oid ",  o_id );
                thisws.sendObj( _.extend(msg, {msg: "link refused. ", link: msg.link, o_id:o_id  } ));
              } );
            }
          }) ;

          break;
      }
      //fs.appendFile("data.txt", data+'\n');

    });

};


