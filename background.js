// Copyright (c) 2012,2013 Peter Coles - http://mrcoles.com/ - All rights reserved.
// Use of this source code is governed by the MIT License found in LICENSE

//
// console object for debugging
//

//
// utility methods
//
function $(id) { return document.getElementById(id); }
function show(id) { $(id).style.display = 'block'; }
function hide(id) { $(id).style.display = 'none'; }

//
// URL Matching test - to verify we can talk to this URL
//
var matches = ['http://*/*', 'https://*/*', 'ftp://*/*', 'file://*/*'],
    noMatches = [/^https?:\/\/chrome.google.com\/.*$/];
function testURLMatches(url) {
    // couldn't find a better way to tell if executeScript
    // wouldn't work -- so just testing against known urls
    // for now...
    var r, i;
    for (i=noMatches.length-1; i>=0; i--) {
        if (noMatches[i].test(url)) {
            return false;
        }
    }
    for (i=matches.length-1; i>=0; i--) {
        r = new RegExp('^' + matches[i].replace(/\*/g, '.*') + '$');
        if (r.test(url)) {
            return true;
        }
    }
    return false;
}


var blocks=['*twitter.com*', '*facebook1.*'];
function testURLBlocks(url) {
    var r, i;
    for (i=blocks.length-1; i>=0; i--) {
        r = new RegExp('^' + blocks[i].replace(/\*/g, '.*') + '$');
        if (r.test(url)) {
            return true;
        }
    }
    return false;
}

chrome.webRequest.onBeforeRequest.addListener(
    function(details) {
        var isBlock = details.tabId>=0 && testURLBlocks(details.url);

        if(isBlock) console.info("Blocked: ", details.url);
        return {cancel: isBlock  };
    },
    {urls: ["<all_urls>"]},
    ["blocking"]
);

function addToHeader(obj, name, value){
    var v = _.findWhere(obj, {"name":name} );
    if(v) v.value=value;
    else obj.push({name:name, value:value});
}


chrome.webRequest.onHeadersReceived.addListener(
    function(e){

        //if( /image|object/.test(e.type) ) return; 
        var headers = e.responseHeaders;

        addToHeader(headers, "Access-Control-Allow-Origin", "*" );
        //addToHeader(headers, "Access-Control-Allow-Headers", "X-Requested-With" );

        return {responseHeaders: headers};
    },
    {urls: ["<all_urls>"]}, // types:["main_frame", "sub_frame", "stylesheet", "script", "image", "object", "xmlhttprequest", "other"] 
    ["blocking", "responseHeaders"]
);


//
// Events
//
var pageLoaded=false;
var screenshot, contentURL = '';
var monkeyCallback;
var getEmailCallback;
var winList, nextLink;
var winQueryInterval;
var tryCount=100;
var hostTab;
var workingTab=-1;

function sendScrollMessage(tab) {
    contentURL = tab.url;
    screenshot = {};
    workingTab = tab.id;

    chrome.tabs.sendMessage(tab.id, {msg: 'scrollPage'}, function() {
        // We're done taking snapshots of all parts of the window. Display
        // the resulting full screenshot image in a new browser tab.
        saveSreen();
    });
}


function sendLogMessage(data) {
    chrome.tabs.query({active:true}, function(tab){
        tab=tab[0];
        chrome.tabs.sendMessage(tab.id, {msg: 'logMessage', data: data}, function() {});
    });
}

function closeTab(id){
    chrome.tabs.remove(id, function(){ chrome.runtime.lastError; } );
    if(workingTab==id) {
        workingTab = -1;
    }
}

chrome.runtime.onMessage.addListener(function(request, sender, callback) {

    if (request.msg === 'capturePage') {
        capturePage(request, sender, callback);
    } else if (request.msg === 'monkeyCapture') {
        //alert("monkeyCapture");
        monkeyCallback=callback;
        start();
    } else if (request.msg === 'initWebsocket') {
        if( !websocket ) initWebsocket(request, callback);
    } else if (request.msg === 'wsend') {
        wsend(request, callback);

    } else if (request.msg === 'closeMe') {
        if(!sender.tab) return true;
        if(0 &&request.url) {
            chrome.tabs.query( {url:[ request.url.split("#")[0] ]}, function(tabs){
                if(tabs.length) {
                    closeTab(tabs[0].id);
                }
            });
            return;
        }
        closeTab(sender.tab.id);

    } else if (request.msg === 'openMe') {
        winList = [];
        hostTab = sender.tab;
        nextLink = request.nextLink;
        _.each( request.winList , function(v,i){
            chrome.tabs.create({ url:v.link, active:false }, function(tab){
                winList.push( { link:tab.url, idx:v.idx, q:v.q, uid:v.uid, tabId:tab.id, status:"opened"  } );
                if(winList.length==request.winList.length){
                    //alert("all opended");
                    if(callback) callback();
                    checkWindowStatus(request, sender, callback);
                }
            });
        });


    } else if (request.msg === 'newGoogleSession') {
        workingTab = -1;

    } else if (request.msg === 'getScreenQueue') {

        if(workingTab>-1){
            callback(false);
        }else{
            workingTab=sender.tab.id;
            chrome.tabs.update(sender.tab.id, {active:true}, function(){
                if (chrome.runtime.lastError) {
                    console.log(chrome.runtime.lastError.message);
                    workingTab = -1;
                    return;
                }
                callback(true);
            });
        }

    } else {
        console.error('Unknown message received from content script: ' + request.msg);
    }
    return true;
});



function checkWindowStatus(request, sender, callback){

    var allClosed = false;
    winQueryCount=0;
    clearInterval(winQueryInterval);
    winQueryInterval = setInterval( function(){
        winQueryCount++;
        console.log(winQueryCount);
        _.each( winList , function(v,i){
            chrome.tabs.get(v.tabId, function(tab){
                //the tab is closed, mark closed
                if (chrome.runtime.lastError) {
                    v.status="closed";
                    closeTab(v.tabId);
                }else{
                    //the tab is opening, check timeout & close it  
                    if(winQueryCount==tryCount) {
                        chrome.tabs.sendMessage(hostTab.id, {msg: 'timeout', link:v.link});
                        closeTab(tab.id); 
                    }
                }
                //check if all is closed
                if (!allClosed && _.where(winList, {status: "closed"}).length == winList.length){
                    allClosed = true;
                    workingTab = -1;
                    clearInterval( winQueryInterval );
                    console.log("all done!!!! at winQueryCount ", winQueryCount );
                    //closeTab(hostTab.id);
                    //chrome.tabs.create({url:request.nextLink, active:true});
                }
                
            });
            
        });
        //console.log( _.map(winList, function(v,i){ return v.status } ) );
        
        return true;

    }, 1000 );

}


function capturePage(data, sender, callback) {
    var canvas;

    $('bar').style.width = parseInt(data.complete * 100, 10) + '%';

    // Get window.devicePixelRatio from the page, not the popup
    var scale = data.devicePixelRatio && data.devicePixelRatio !== 1 ?
        1 / data.devicePixelRatio : 1;

    // if the canvas is scaled, then x- and y-positions have to make
    // up for it
    if (scale !== 1) {
        data.x = data.x / scale;
        data.y = data.y / scale;
        data.totalWidth = data.totalWidth / scale;
        data.totalHeight = data.totalHeight / scale;
    }


    if (!screenshot.canvas) {
        canvas = document.createElement('canvas');
        canvas.width = data.totalWidth;
        canvas.height = data.totalHeight;
        screenshot.canvas = canvas;
        screenshot.ctx = canvas.getContext('2d');
        console.log(screenshot);
        // sendLogMessage('TOTALDIMENSIONS: ' + data.totalWidth + ', ' + data.totalHeight);

        // // Scale to account for device pixel ratios greater than one. (On a
        // // MacBook Pro with Retina display, window.devicePixelRatio = 2.)
        // if (scale !== 1) {
        //     // TODO - create option to not scale? It's not clear if it's
        //     // better to scale down the image or to just draw it twice
        //     // as large.
        //     screenshot.ctx.scale(scale, scale);
        // }
    }

    // sendLogMessage(data);

    chrome.tabs.captureVisibleTab(
        null, {format: 'png', quality: 50}, function(dataURI) {
            if (chrome.runtime.lastError) {
                console.log(chrome.runtime.lastError.message);
                callback(false);
                return;
            }
            if (dataURI) {
                var image = new Image();
                image.onload = function() {
                    // sendLogMessage('img dims: ' + image.width + ', ' + image.height);
                    screenshot.ctx.drawImage(image, data.x, data.y);
                    callback(true);
                };
                image.src = dataURI;
            }
        });
}




/*
Local Socket start
*/

var localSocket, isManual=false;

var islocalSocketOpen = false;
try{
    localSocket = new WebSocket('ws://127.0.0.1:8080/ws?id=1234&abc=skdjf' );
}catch(e){
    alert("no connection to localSocket");
}
//localSocket.binaryType = "blob";
localSocket.onopen = function (event){
    //localSocket.send(name+"@@@@"+dataURI);
    //save image file to disk
    islocalSocketOpen = true;
    
    //this.close();
};
localSocket.onclose = function (closeE){
    console.log(closeE.reason, closeE.code, closeE.wasClean);
    //alert("localSocket close");
};
localSocket.onmessage = function (e){
    console.log(e,e.data);
    //alert("message: "+e.data);
};
localSocket.onerror = function (e){
    console.log(e);
    //alert("localSocket error"+name);
    if(!islocalSocketOpen && monkeyCallback) {
        
    }
};


/*
Remote Socket start
*/

var websocket;
var wsReconnectInterval;
var wsQueue={};
var uid = (new Date()).getTime();


function wsend(obj, callback){
    if( !(websocket && websocket.readyState==1) ) return;
    if(callback){
        obj.msgid = (+new Date()) + (Math.random().toString().slice(-4));
        //var tempObj={}; tempObj[obj.msgid] = callback; //have to be this way to create a object literal with expression
        wsQueue[obj.msgid] = callback;
    }
    websocket.send( JSON.stringify( obj )  , function onerror(error) { console.log("ERROR: ", error); } );
}


function initWebsocket(req, callback){
    var param = req.param;
    var domain = req.domain;

    var wsurl = 'ws://1111hui.com:8080';
        wsurl += '/search?uid=' + uid + '&' +param;

    
    try{
    websocket = new WebSocket(wsurl, domain );
    }catch(e){
        console.log("ERRRRRRRRRR!!", e);
        return;
    }

    //websocket.binaryType = "blob";
    websocket.onopen = function (event){
        clearInterval(wsReconnectInterval);

        //var msg = new Uint32Array([17, -45.3]);
        //websocket.send( JSON.stringify( {} )  , function onerror(error) {} );
    };
    websocket.onclose = function (closeE){
        console.log(closeE.reason, closeE.code, closeE.wasClean);
        if(closeE.reason==1006){
            wsReconnectInterval = setInterval(function(){ initWebsocket(req); }, 1000);
        }
    };
    websocket.onmessage = function (e){
        //console.log(e,e.data);
        if(e.data[0]!="{")return;

        var d=JSON.parse(e.data);
        var callObj= wsQueue[d.msgid];
        if(callObj){
            callObj.call(this, d);
            delete wsQueue[d.msgid];
        }
    };
    websocket.onerror = function (e){
        console.log("ERRRRRRRRRR!! ",e);
    };
}





function saveSreen(){
    // come up with a filename
    var name = contentURL.split('?')[0].split('#')[0];
    if (name) {
        name = name
            .replace(/^https?:\/\//, '')
            .replace(/[^A-z0-9]+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^[_\-]+/, '')
            .replace(/[_\-]+$/, '');
        name = '-' + name;
    } else {
        name = '';
    }
    name = 'screencapture' + name + '-' + Date.now() + '.png';

    var dataURI = screenshot.canvas.toDataURL("image/png", 0.5);
    
    workingTab = -1;

    if(isManual) {
        openPage(name, dataURI);
        return;
    }

    if(localSocket.readyState==1){
        localSocket.send(contentURL+"@@@@"+name+"@@@@"+dataURI);
        if(monkeyCallback) {
            monkeyCallback(name);
        }
    }else{
        monkeyCallback("");
    }
}


function openPage(name, dataURI) {
    // standard dataURI can be too big, let's blob instead
    // http://code.google.com/p/chromium/issues/detail?id=69227#c27
    
    // convert base64 to raw binary data held in a string
    // doesn't handle URLEncoded DataURIs
    var byteString = atob(dataURI.split(',')[1]);

    // separate out the mime component
    var mimeString = dataURI.split(',')[0].split(':')[1].split(';')[0];

    // write the bytes of the string to an ArrayBuffer
    var ab = new ArrayBuffer(byteString.length);
    var ia = new Uint8Array(ab);
    for (var i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
    }

    // create a blob for writing to a file
    var blob = new Blob([ab], {type: mimeString});

    // come up with file-system size with a little buffer
    var size = blob.size + (1024/2);


    function onwriteend() {
        // open the file that now contains the blob
        window.open('filesystem:chrome-extension://' + chrome.i18n.getMessage('@@extension_id') + '/temporary/' + name);
    }

    function errorHandler() {
        show('uh-oh');
    }

    // create a blob for writing to a file
    window.webkitRequestFileSystem(window.TEMPORARY, size, function(fs){
        fs.root.getFile(name, {create: true}, function(fileEntry) {
            fileEntry.createWriter(function(fileWriter) {
                fileWriter.onwriteend = onwriteend;
                fileWriter.write(blob);
            }, errorHandler);
        }, errorHandler);
    }, errorHandler);
}








function executeScripts(tabId, injectDetailsArray)
{
    function createCallback(tabId, injectDetails, innerCallback) {
        return function () {
            chrome.tabs.executeScript(tabId, injectDetails, innerCallback);
        };
    }

    var callback = null;

    for (var i = injectDetailsArray.length - 1; i >= 0; --i)
        callback = createCallback(tabId, injectDetailsArray[i], callback);

    if (callback !== null)
        callback();   // execute outermost function
}



//
// start doing stuff immediately! - including error cases
//


chrome.tabs.onUpdated.addListener ( function(tabId, updateInfo, tab) {
    if (chrome.runtime.lastError) {
        console.log(chrome.runtime.lastError.message);
        return;
    }
    if(testURLMatches(tab.url) && tab.status=="complete"){
    
    var param = _.findWhere(winList, {tabId: tabId });
    if(param){
        var qurl = param.link +'#Qoftheworker=q='+ param.q +'&pid='+param.uid+'';
        chrome.tabs.executeScript(tab.id, {code: 'window.Qoftheworker="'+ qurl +'"'  , runAt:"document_end"}, function() { if(chrome.runtime.lastError) return; });        
    }

    chrome.tabs.executeScript(tab.id, {file: 'onMessage.js', runAt:"document_end"}, function() { if(chrome.runtime.lastError) return; });
    chrome.tabs.executeScript(tab.id, {file: 'page.js', runAt:"document_end"}, function() {
        if(chrome.runtime.lastError) return;
        pageLoaded = true;
    });


    chrome.tabs.executeScript(tab.id, {file: 'underscore-min.js', runAt:"document_end"}, function() {
    if(chrome.runtime.lastError) return;
    chrome.tabs.executeScript(tab.id, {file: 'jquery.min.js', runAt:"document_end"}, function() {
         if(chrome.runtime.lastError) return;
         chrome.tabs.executeScript(tab.id, {file: 'googleEmail.js', runAt:"document_end"}, function() {
             if(chrome.runtime.lastError) return;
        });
    });
    });

    }
});


var viewsPage = chrome.extension.getViews();
var bgPage = chrome.extension.getBackgroundPage();

function clientLog(code){
    chrome.tabs.executeScript({
        code: code
    });
}


// reload crashed tabs
if(chrome.processes){
    chrome.processes.onExited.addListener(function( processId,  exitType,  exitCode) {
        chrome.processes.getProcessInfo(processId, false, function( proc ) {
            for(var i=0; i<proc.tabs.length; i++){
                setTimeout(function(){ chrome.tabs.reload(proc.tabs[i]); }, 1000);
            }
        });
    });
}

chrome.webNavigation.onErrorOccurred.addListener(onErrorOccurred, {urls: ["http://*/*", "https://*/*"]});

function onErrorOccurred(err)
{

    if( ! testURLMatches(err.url) ) return;

    chrome.tabs.get(err.tabId, function(tab){

        if (chrome.runtime.lastError) return;

        if (err.frameId==0 && tab.url==err.url && !/ERR_ABORTED|ERR_BLOCKED_BY_CLIENT/.test(err.error) ) {
            console.log("load error: " + err.url);
            setTimeout(function(){ chrome.tabs.reload(err.tabId); }, 1000);
        }

        if (err.error == "net::ERR_NAME_NOT_RESOLVED")
            chrome.tabs.update(err.tabId, {url: "about:blank"});
    
    });
}



function start(){

chrome.tabs.query({active:true}, function(tab){

    tab = tab[0];

    if (testURLMatches(tab.url)) {

        if(!pageLoaded){
            chrome.tabs.executeScript(tab.id, {file: 'onMessage.js', runAt:"document_start"}, function() { if(chrome.runtime.lastError) return; });
            chrome.tabs.executeScript(tab.id, {file: 'page.js', runAt:"document_start"}, function() {
                if(chrome.runtime.lastError) return;
                pageLoaded = true;
                show("loading");
                sendScrollMessage(tab);
            });
        }else{
            sendScrollMessage(tab);
        }

        window.setTimeout(function() {
            if (!pageLoaded) {
                show('uh-oh');
            }
        }, 1000);
    } else {
        show('invalid');
    }
});
}


chrome.browserAction.onClicked.addListener(function(tab) {
    isManual = true;
    start();
    return;

	if(tab.status=="complete"){
		
	}else{
        chrome.tabs.onUpdated.removeListener(setupUpdateHook);
		chrome.tabs.onUpdated.addListener(setupUpdateHook);		
	}

});

function setupUpdateHook(tabId, updateInfo, tab) {
	if(tab.status=="complete"){
		chrome.tabs.onUpdated.removeListener(setupUpdateHook);
	    start();
	}
}

