// ==UserScript==
// @name         [Google]Email
// @namespace    http://your.homepage/
// @version      0.1
// @description  enter something useful
// @author       You
// @require  http://1111hui.com/js/jquery.js
// @require  http://1111hui.com/js/underscore.js
// @match        https://www.google.com*
// @match        https://*/*
// @match        http://*/*
// ==/UserScript==

var lastEl = function(ar) {
    return ar[ar.length-1];
}

function paramToJson(str) {
    return str.split('&').reduce(function (params, param) {
        var paramSplit = param.split('=').map(function (value) {
            return decodeURIComponent(value.replace(/\+/g, ' '));
        });
        params[paramSplit[0]] = paramSplit[1];
        return params;
    }, {});
}

function eve(el, type){
    el= ('jquery' in el)? el.get(0) : el ;  //(typeof el['jquery']!='undefined')
    if(typeof type=='undefined') type='click';
    var click = document.createEvent("MouseEvents");
    click.initMouseEvent(type, true, true, window,
                         0, 0, 0, 0, 0, false, false, false, false, 0, null);
    button = el;
    button.dispatchEvent(click);
    button.focus();
}
function simulateKeyPress(character) {
    jQuery.event.trigger({ type : 'keypress', which : character.charCodeAt(0) });
}

function $$(sel){ return document.querySelector(sel); }

function wait(condition, passfunc, failfunc){
    var _inter = setInterval(function(){
        if( eval(condition) ){
            clearInterval(_inter);
            passfunc.call();
        }else{
            if(failfunc) failfunc.call();
        }
    },300);
    return _inter;
}

var tryCount = 10;

var emailRE = /\b(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))\b/igm;
var failedCount = 0;
var inter1;
var totalLinkCount = 0;
var domLoaded = false;
var param, keyword, startCount;
var winList=[];
var winQueryInterval, winQueryCount=0;

$(document).ready(function(){
    domLoaded = true;
});

function main(){

    var url = getSearchUrl();
    param = paramToJson( url );
    if(!param.q ) return;
    keyword = encodeURIComponent(param.q);
    

    startCount = parseInt(param.start);
    if( isNaN(startCount) ) startCount = 0;

    failedCount = 0;
    var v= document.querySelectorAll('li.g h3.r a');
    for(i=0; i<v.length; i++){
        var idx = (startCount+i);
        v[i].removeAttribute('onmousedown');
        v[i].removeAttribute('target');
        v[i].className+=' passed ';
        //var workerLink = ''+ v[i].href +'#Qoftheworker=q='+ param.q +'&pid='+uid+'';
        var workerLink = ''+ v[i].href;
        v[i].setAttribute('data-workerlink',workerLink);
        //v[i].setAttribute('onclick', 'window.open("'+ workerLink +'", "google|'+ idx +'|'+ v[i].href +'"); return false; ' );
        v[i].setAttribute('onclick', 'window.open("'+ v[i].href +'", "google|'+ idx +'|'+ v[i].href +'"); return false; ' );
        console.log("ready send: ", idx, v[i].href);
    }
    console.log(domLoaded);

    $('#__opengoogle').remove();

    $('#hdtb_msb, #hdtb-msb').append('<div style="position:absolute; top:0; right:-50px;"><input type="button" value="打开" id="__opengoogle"></div>');
    
    $('#__opengoogle').unbind().click(function(){
        if(param.gnext!=1) {
            window.open("https://www.google.com/#newwindow=1&q="+ keyword +"&start="+ startCount + "&gnext=1&filter=0" );
            chrome.runtime.sendMessage({msg:"closeMe"  });
            return;
        } else {
            startCrawl();
        }
    });
    
    if(param.gnext==1){
        setTimeout( function(){ $('#__opengoogle').click(); }, 1000);
    }
}

function wsend(obj, callback){
    chrome.runtime.sendMessage( _.extend(obj, {msg:"wsend"} ) , callback);
}


function startCrawl(){
    
    totalLinkCount=0;
    window.stop();

    var v= document.querySelectorAll('li.g h3.r a');
    for(i=0; i<v.length; i++){
        var idx = (startCount+i);
        var link = $( v[i] );
        var desc = $( v[i] ).parent().next().find('span.st');
        if(!link.size() ) continue;
        wsend( {action:"discover", q:encodeURIComponent(param.q), idx:idx, link:link.attr('href'), title:link.html(), desc:desc.html()  }, function(ret){ 
            console.log("ret: ", ret) 
            totalLinkCount++;

            if(totalLinkCount==v.length){
                openAllLink();
            }
        } );
    }
    
    

}

function openAllLink(){
    var v= document.querySelectorAll('li.g h3.r a');

    winList=[];
    for(i=0; i<v.length; i++){
        //console.log(i,v[i], v[i].href );
        var link = v[i].getAttribute("data-workerlink");
        var idx = startCount+i;
        
        //var win = window.open(link,"google"+(idx) );
        winList.push({link:link, idx: idx, q:param.q });

    }

    //Next Link Info
    //eve( $('a.pn') );    //The AJAX of google will make big memery. so we open a new window and close it.
    var nextL = document.querySelector('#pnnext').href.split("?").pop();
    var nextP = paramToJson(nextL).start || (startCount+10);
    var nextLink = "https://www.google.com/#newwindow=1&q="+ keyword +"&start="+ nextP + "&gnext=1&filter=0" ;
    //open list of urls, and return JSON of winList with tabIds
    wsend( {action:"init", slink:window.location.href } );
    chrome.runtime.sendMessage({msg:"openMe", winList:winList, nextLink:nextLink }, function(){

    });
}

function checkWindowStatus(winList){

    winQueryCount=0;
    clearInterval(winQueryInterval);
    winQueryInterval = setInterval( function(){
        var allOK = true;
        winQueryCount++;
        console.log(winQueryCount, winList);

        var closedA =_.map(winList, function(v,i){
            return v.win.closed;
        });
        console.log(winQueryCount, closedA);

        _.each(winList, function(v,i){
            if ( ! (v.win && v.win.closed) ) {
                allOK=false;
                if(winQueryCount>tryCount) {

                    wsend( {action:"timeout", q:encodeURIComponent(param.q), link:v.link  } );
                    //if(v.win) v.win.close();
                    chrome.runtime.sendMessage({msg:"closeMe", url:v.link });
                }
            }
        });

        if(winQueryCount>tryCount+1 || allOK ){
            clearInterval( winQueryInterval );
            console.log("all done!!!!", startCount );

            _.each(winList, function(v,i){ chrome.runtime.sendMessage({msg:"closeMe", url:v.link }); });
            //window.open("https://www.google.com/#newwindow=1&q="+ keyword +"&start="+ nextP + "&gnext=1&filter=0" );
            chrome.runtime.sendMessage({msg:"closeMe"  });
        }
    }, 1000 );

}


var workerObj={};
var isWorker, workerInterval;

function monitorGoogleURLChange() {
    clearInterval(inter1);


    var url = getSearchUrl();
    var param = paramToJson( url );

    if(param.q  ){
        $(window).off('hashchange');
        chrome.runtime.sendMessage( {msg:"initWebsocket", param: url, domain: "www.google.com"} );
    }

    failedCount=0;
    inter1 = wait(' document.querySelectorAll("li.g h3.r") && document.querySelectorAll("li.g h3.r").length>1 && document.querySelectorAll("li.g h3.r a.passed").length==0 ',  main, function(){
        return;
        failedCount++; 
        if(failedCount>100  && !domLoaded ){  // && $(".med.card-section").size()==0
            clearInterval(inter1);
            window.location.reload();  
        }
    });
}

function getSearchUrl(){
    return /q=/i.test(window.location.search) ? window.location.search.substr(1) : window.location.hash.substr(1);
}

function getTextHtml(){
    $('*[style]').removeAttr('style');
    $('img').each(function(i,e){
        $(this).replaceWith(function() { return this.alt || this.title || "image"+i ; });
    });
    $('object,embed').each(function(i,e){
        $(this).replaceWith(function() { return this.alt || this.title || "object"+i ; });
    });
    
    $('style,script,noscript,link,img,object,embed').remove();
    return $('html')[0].outerHTML;
}

function getEmail(data) {
    console.log("ret: ", data);  
        
    function update_email(name){
        if(  !(data.o_ids && data.o_ids.length) ) return;
        o_id = data.o_ids[0];
        var html = getTextHtml();
        var email = html.match(emailRE);
        email = email ? email.map(function(v,i){ return v; }).join(";") : "";
        
        wsend({ action:"update_email", o_id:o_id, email: email , html:html, text:$('body').text(), image:name  }, function(data){
            console.log(data);
            chrome.runtime.sendMessage({msg:"closeMe", url: window.location.href.split("#")[0] });
        });
    }


    if(data.total>0){

        chrome.runtime.sendMessage({msg:"monkeyCapture"  }, function(name) {
            //alert("monkey captured");
            update_email(name);
        });

    }else{
         chrome.runtime.sendMessage({msg:"closeMe", url: window.location.href.split("#")[0] });
    }
}

function init(){

    if( window.location.href.match(/google.com/) ){

        
        $(window).on('hashchange', monitorGoogleURLChange );
        monitorGoogleURLChange();

        return;
    }
    //document.referrer.match(/google\.|googleusercontent\./) &&
    //if(   window.location.href.match(/Qoftheworker/) ){
    if(   window.Qoftheworker ) {
        isWorker = true;
        var workerA = window.Qoftheworker.split("#Qoftheworker=");
        workerObj.link = workerA[0];
        workerObj.param = lastEl(workerA);
        workerObj.paramJson = paramToJson(lastEl(workerA) );
        
        //initWebsocket("", "theworker");

        console.log("start worker");

        //check if we can screen capture and save work.
        workerInterval=setInterval(function(){
            chrome.runtime.sendMessage({ msg:"getScreenQueue"}, function( canDo ){
                console.log("canDo",canDo);
                if(canDo){
                    clearInterval(workerInterval);
                    wsend({ action:"get_new_slot", link:workerObj.link }, getEmail);
                }
            });
        }, 300);

        return;
    }
}

init();
