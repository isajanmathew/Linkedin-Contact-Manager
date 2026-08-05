(function(){if(typeof chrome!=='undefined'&&chrome.runtime&&chrome.runtime.id)return;
var s={};function sa(bk){return{get:function(k,c){var r={},ks=typeof k==='string'?[k]:Array.isArray(k)?k:Object.keys(k||{});
ks.forEach(function(x){var v=bk[x];if(v!==undefined)r[x]=JSON.parse(JSON.stringify(v))});if(c)c(r);return Promise.resolve(r)},
set:function(items,c){Object.keys(items).forEach(function(x){bk[x]=items[x]});if(c)c();return Promise.resolve()},
remove:function(k,c){(typeof k==='string'?[k]:k).forEach(function(x){delete bk[x]});if(c)c();return Promise.resolve()},
clear:function(c){Object.keys(bk).forEach(function(x){delete bk[x]});if(c)c();return Promise.resolve()}};}
var noop=function(){};var noopL={addListener:noop,removeListener:noop,hasListener:function(){return false}};
window.chrome={runtime:{id:'dev-preview',lastError:null,sendMessage:function(m,c){if(c)setTimeout(function(){c({data:null})},0);return Promise.resolve()},
onMessage:noopL,onInstalled:noopL,getURL:function(p){return p}},storage:{local:sa(s),sync:sa({}),onChanged:noopL},
tabs:{query:function(q,c){if(c)c([]);return Promise.resolve([])},sendMessage:function(i,m,c){if(c)c({});return Promise.resolve()},
create:function(o,c){var t={id:1};if(c)c(t);return Promise.resolve(t)}},
commands:{onCommand:noopL,getAll:function(c){if(c)c([]);return Promise.resolve([])}},
contextMenus:{create:noop,onClicked:noopL},alarms:{create:noop,get:function(n,c){if(c)c(null);return Promise.resolve(null)},
onAlarm:noopL},action:{setBadgeText:noop,setBadgeBackgroundColor:noop,setIcon:noop},
scripting:{executeScript:function(){return Promise.resolve([])}},sidePanel:{setOptions:noop,open:function(){console.log('chrome.sidePanel.open called');return Promise.resolve()}}};
var p=window.parent;if(p&&p!==window){
window.onerror=function(m,src,l,c,e){p.postMessage({type:'RUNTIME_ERROR',error:{message:String(m),stack:e&&e.stack||'',source:'runtime',location:{filename:src,line:l,column:c}}},'*');};
window.addEventListener('unhandledrejection',function(ev){var e=ev.reason;p.postMessage({type:'RUNTIME_ERROR',error:{message:e&&e.message||String(e),stack:e&&e.stack||'',source:'promise'}},'*');});
new MutationObserver(function(ms){ms.forEach(function(m){m.addedNodes.forEach(function(n){if(n.tagName&&n.tagName.toLowerCase()==='vite-error-overlay'){var t=n.shadowRoot&&n.shadowRoot.querySelector('.message-body');p.postMessage({type:'BUILD_ERROR',error:{message:t?t.textContent:'Vite build error',source:'hmr'}},'*');}});});}).observe(document.documentElement,{childList:true,subtree:true});
}})();
