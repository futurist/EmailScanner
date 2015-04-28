
if (!window.hasScreenCapturePage) {
    window.hasScreenCapturePage = true;
	function onMessage(request, sender, callback) {
	    
	    //for message of googleEmail.js
	    if (request.msg === 'timeout') {
	        wsend( {action:"timeout", q:encodeURIComponent(param.q), link:request.link  } );
	        if(callback)callback();
	    }

	    
	    //for Message of page.js
	    if (request.msg === 'scrollPage') {
	        getPositions(callback);
	    }
	    
	    return true;
	}
	chrome.runtime.onMessage.addListener(onMessage);
}


