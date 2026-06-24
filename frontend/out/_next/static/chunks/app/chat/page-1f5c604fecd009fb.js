(self.webpackChunk_N_E=self.webpackChunk_N_E||[]).push([[929],{7526:function(e,t,n){Promise.resolve().then(n.bind(n,5450))},5450:function(e,t,n){"use strict";n.r(t),n.d(t,{default:function(){return f}});var r=n(7437),s=n(2265),i=n(7390);/**
 * @license lucide-react v0.441.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let l=(0,n(8030).Z)("ArrowRight",[["path",{d:"M5 12h14",key:"1ays0h"}],["path",{d:"m12 5 7 7-7 7",key:"xquz4c"}]]);var a=n(9896),c=n(2917),o=n(4016);let u="chat_identity";function d(e){let{onReady:t}=e,[n,a]=(0,s.useState)(""),[c,d]=(0,s.useState)(""),[f,h]=(0,s.useState)(!1),[x,m]=(0,s.useState)(""),p=async e=>{e.preventDefault();let r=n.trim().toLowerCase().replace(/^@/,"");if(!r){m("Pick an id (e.g. @sara)");return}if(!/^[a-z0-9._-]{2,32}$/.test(r)){m("Use 2–32 letters, numbers, . _ -");return}let s={id:r,handle:r,name:c.trim()||r,kind:"agent"};h(!0);try{await (0,o.UD)(s),localStorage.setItem(u,JSON.stringify(s)),t(s)}catch(e){m((null==e?void 0:e.message)||"Could not register")}finally{h(!1)}};return(0,r.jsx)("div",{className:"min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-900 p-4",children:(0,r.jsxs)("form",{onSubmit:p,className:"w-full max-w-sm bg-white rounded-3xl shadow-2xl p-7",children:[(0,r.jsxs)("div",{className:"flex items-center gap-2 mb-1 text-blue-600",children:[(0,r.jsx)(i.Z,{size:24}),(0,r.jsx)("h1",{className:"text-xl font-black text-slate-900",children:"Team Chat"})]}),(0,r.jsx)("p",{className:"text-sm text-slate-500 mb-5",children:"Pick the id others will use to reach you."}),(0,r.jsx)("label",{className:"block text-xs font-bold text-slate-500 mb-1",children:"Your id / handle"}),(0,r.jsxs)("div",{className:"flex items-center rounded-xl border border-slate-200 bg-slate-50 px-3 mb-3 focus-within:ring-2 focus-within:ring-blue-300",children:[(0,r.jsx)("span",{className:"text-slate-400 font-semibold",children:"@"}),(0,r.jsx)("input",{autoFocus:!0,value:n,onChange:e=>a(e.target.value),placeholder:"sara",className:"flex-1 bg-transparent py-2.5 px-1 focus:outline-none text-slate-900"})]}),(0,r.jsx)("label",{className:"block text-xs font-bold text-slate-500 mb-1",children:"Display name (optional)"}),(0,r.jsx)("input",{value:c,onChange:e=>d(e.target.value),placeholder:"Sara from Support",className:"w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 px-3 mb-5 focus:outline-none focus:ring-2 focus:ring-blue-300 text-slate-900"}),x&&(0,r.jsx)("p",{className:"text-sm text-red-500 mb-3",children:x}),(0,r.jsx)("button",{type:"submit",disabled:f,className:"w-full flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 transition disabled:opacity-60",children:f?"Connecting…":(0,r.jsxs)(r.Fragment,{children:["Enter chat ",(0,r.jsx)(l,{size:18})]})}),(0,r.jsx)("p",{className:"mt-4 text-[11px] text-center text-slate-400",children:"Anyone with your id can message you. Share it like a username."})]})})}function f(){let[e,t]=(0,s.useState)(null),[n,l]=(0,s.useState)(!1);return((0,s.useEffect)(()=>{t(function(){try{let e=localStorage.getItem(u);if(!e)return null;let t=JSON.parse(e);return(null==t?void 0:t.id)?t:null}catch(e){return null}}()),l(!0)},[]),n)?e?(0,r.jsxs)("div",{className:"h-screen flex flex-col bg-slate-100",children:[(0,r.jsxs)("header",{className:"flex items-center justify-between px-4 py-2.5 bg-white border-b border-slate-200 shrink-0",children:[(0,r.jsxs)("div",{className:"flex items-center gap-2",children:[(0,r.jsx)("div",{className:"h-8 w-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center",children:(0,r.jsx)(i.Z,{size:16})}),(0,r.jsxs)("div",{className:"leading-tight",children:[(0,r.jsx)("p",{className:"text-sm font-bold text-slate-900",children:e.name}),(0,r.jsxs)("p",{className:"text-[11px] text-slate-400",children:["@",e.handle||e.id]})]})]}),(0,r.jsxs)("button",{onClick:()=>{try{localStorage.removeItem(u)}catch(e){}t(null)},className:"flex items-center gap-1.5 text-sm text-slate-500 hover:text-red-600 transition",title:"Sign out",children:[(0,r.jsx)(a.Z,{size:16})," ",(0,r.jsx)("span",{className:"hidden sm:inline",children:"Sign out"})]})]}),(0,r.jsx)("div",{className:"flex-1 min-h-0 p-2 md:p-4",children:(0,r.jsx)(c.Z,{me:e,heightClass:"h-full"})})]}):(0,r.jsx)(d,{onReady:t}):(0,r.jsx)("div",{className:"min-h-screen bg-slate-900"})}},8030:function(e,t,n){"use strict";n.d(t,{Z:function(){return c}});var r=n(2265);/**
 * @license lucide-react v0.441.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let s=e=>e.replace(/([a-z0-9])([A-Z])/g,"$1-$2").toLowerCase(),i=function(){for(var e=arguments.length,t=Array(e),n=0;n<e;n++)t[n]=arguments[n];return t.filter((e,t,n)=>!!e&&n.indexOf(e)===t).join(" ")};/**
 * @license lucide-react v0.441.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */var l={xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"};/**
 * @license lucide-react v0.441.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let a=(0,r.forwardRef)((e,t)=>{let{color:n="currentColor",size:s=24,strokeWidth:a=2,absoluteStrokeWidth:c,className:o="",children:u,iconNode:d,...f}=e;return(0,r.createElement)("svg",{ref:t,...l,width:s,height:s,stroke:n,strokeWidth:c?24*Number(a)/Number(s):a,className:i("lucide",o),...f},[...d.map(e=>{let[t,n]=e;return(0,r.createElement)(t,n)}),...Array.isArray(u)?u:[u]])}),c=(e,t)=>{let n=(0,r.forwardRef)((n,l)=>{let{className:c,...o}=n;return(0,r.createElement)(a,{ref:l,iconNode:t,className:i("lucide-".concat(s(e)),c),...o})});return n.displayName="".concat(e),n}},5137:function(e,t,n){"use strict";n.d(t,{Z:function(){return r}});/**
 * @license lucide-react v0.441.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let r=(0,n(8030).Z)("ArrowLeft",[["path",{d:"m12 19-7-7 7-7",key:"1l729n"}],["path",{d:"M19 12H5",key:"x3x0zl"}]])},2638:function(e,t,n){"use strict";n.d(t,{Z:function(){return r}});/**
 * @license lucide-react v0.441.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let r=(0,n(8030).Z)("CheckCheck",[["path",{d:"M18 6 7 17l-5-5",key:"116fxf"}],["path",{d:"m22 10-7.5 7.5L13 16",key:"ke71qq"}]])},2468:function(e,t,n){"use strict";n.d(t,{Z:function(){return r}});/**
 * @license lucide-react v0.441.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let r=(0,n(8030).Z)("Check",[["path",{d:"M20 6 9 17l-5-5",key:"1gmf2c"}]])},8165:function(e,t,n){"use strict";n.d(t,{Z:function(){return r}});/**
 * @license lucide-react v0.441.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let r=(0,n(8030).Z)("Circle",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}]])},8604:function(e,t,n){"use strict";n.d(t,{Z:function(){return r}});/**
 * @license lucide-react v0.441.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let r=(0,n(8030).Z)("Image",[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",ry:"2",key:"1m3agn"}],["circle",{cx:"9",cy:"9",r:"2",key:"af1f0g"}],["path",{d:"m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21",key:"1xmnt7"}]])},3274:function(e,t,n){"use strict";n.d(t,{Z:function(){return r}});/**
 * @license lucide-react v0.441.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let r=(0,n(8030).Z)("LoaderCircle",[["path",{d:"M21 12a9 9 0 1 1-6.219-8.56",key:"13zald"}]])},9896:function(e,t,n){"use strict";n.d(t,{Z:function(){return r}});/**
 * @license lucide-react v0.441.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let r=(0,n(8030).Z)("LogOut",[["path",{d:"M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4",key:"1uf3rs"}],["polyline",{points:"16 17 21 12 16 7",key:"1gabdz"}],["line",{x1:"21",x2:"9",y1:"12",y2:"12",key:"1uyos4"}]])},7390:function(e,t,n){"use strict";n.d(t,{Z:function(){return r}});/**
 * @license lucide-react v0.441.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let r=(0,n(8030).Z)("MessageSquare",[["path",{d:"M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",key:"1lielz"}]])},9333:function(e,t,n){"use strict";n.d(t,{Z:function(){return r}});/**
 * @license lucide-react v0.441.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let r=(0,n(8030).Z)("Mic",[["path",{d:"M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z",key:"131961"}],["path",{d:"M19 10v2a7 7 0 0 1-14 0v-2",key:"1vc78b"}],["line",{x1:"12",x2:"12",y1:"19",y2:"22",key:"x3vr5v"}]])},2365:function(e,t,n){"use strict";n.d(t,{Z:function(){return r}});/**
 * @license lucide-react v0.441.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let r=(0,n(8030).Z)("Paperclip",[["path",{d:"m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48",key:"1u3ebp"}]])},4841:function(e,t,n){"use strict";n.d(t,{Z:function(){return r}});/**
 * @license lucide-react v0.441.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let r=(0,n(8030).Z)("Pause",[["rect",{x:"14",y:"4",width:"4",height:"16",rx:"1",key:"zuxfzm"}],["rect",{x:"6",y:"4",width:"4",height:"16",rx:"1",key:"1okwgv"}]])},8094:function(e,t,n){"use strict";n.d(t,{Z:function(){return r}});/**
 * @license lucide-react v0.441.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let r=(0,n(8030).Z)("Play",[["polygon",{points:"6 3 20 12 6 21 6 3",key:"1oa8hb"}]])},4817:function(e,t,n){"use strict";n.d(t,{Z:function(){return r}});/**
 * @license lucide-react v0.441.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let r=(0,n(8030).Z)("Search",[["circle",{cx:"11",cy:"11",r:"8",key:"4ej97u"}],["path",{d:"m21 21-4.3-4.3",key:"1qie3q"}]])},994:function(e,t,n){"use strict";n.d(t,{Z:function(){return r}});/**
 * @license lucide-react v0.441.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let r=(0,n(8030).Z)("Send",[["path",{d:"M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z",key:"1ffxy3"}],["path",{d:"m21.854 2.147-10.94 10.939",key:"12cjpa"}]])},883:function(e,t,n){"use strict";n.d(t,{Z:function(){return r}});/**
 * @license lucide-react v0.441.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let r=(0,n(8030).Z)("Trash2",[["path",{d:"M3 6h18",key:"d0wm0j"}],["path",{d:"M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6",key:"4alrt4"}],["path",{d:"M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2",key:"v07s0e"}],["line",{x1:"10",x2:"10",y1:"11",y2:"17",key:"1uufr5"}],["line",{x1:"14",x2:"14",y1:"11",y2:"17",key:"xtxkd"}]])},357:function(e,t,n){"use strict";var r,s;e.exports=(null==(r=n.g.process)?void 0:r.env)&&"object"==typeof(null==(s=n.g.process)?void 0:s.env)?n.g.process:n(8081)},8081:function(e){!function(){var t={229:function(e){var t,n,r,s=e.exports={};function i(){throw Error("setTimeout has not been defined")}function l(){throw Error("clearTimeout has not been defined")}function a(e){if(t===setTimeout)return setTimeout(e,0);if((t===i||!t)&&setTimeout)return t=setTimeout,setTimeout(e,0);try{return t(e,0)}catch(n){try{return t.call(null,e,0)}catch(n){return t.call(this,e,0)}}}!function(){try{t="function"==typeof setTimeout?setTimeout:i}catch(e){t=i}try{n="function"==typeof clearTimeout?clearTimeout:l}catch(e){n=l}}();var c=[],o=!1,u=-1;function d(){o&&r&&(o=!1,r.length?c=r.concat(c):u=-1,c.length&&f())}function f(){if(!o){var e=a(d);o=!0;for(var t=c.length;t;){for(r=c,c=[];++u<t;)r&&r[u].run();u=-1,t=c.length}r=null,o=!1,function(e){if(n===clearTimeout)return clearTimeout(e);if((n===l||!n)&&clearTimeout)return n=clearTimeout,clearTimeout(e);try{n(e)}catch(t){try{return n.call(null,e)}catch(t){return n.call(this,e)}}}(e)}}function h(e,t){this.fun=e,this.array=t}function x(){}s.nextTick=function(e){var t=Array(arguments.length-1);if(arguments.length>1)for(var n=1;n<arguments.length;n++)t[n-1]=arguments[n];c.push(new h(e,t)),1!==c.length||o||a(f)},h.prototype.run=function(){this.fun.apply(null,this.array)},s.title="browser",s.browser=!0,s.env={},s.argv=[],s.version="",s.versions={},s.on=x,s.addListener=x,s.once=x,s.off=x,s.removeListener=x,s.removeAllListeners=x,s.emit=x,s.prependListener=x,s.prependOnceListener=x,s.listeners=function(e){return[]},s.binding=function(e){throw Error("process.binding is not supported")},s.cwd=function(){return"/"},s.chdir=function(e){throw Error("process.chdir is not supported")},s.umask=function(){return 0}}},n={};function r(e){var s=n[e];if(void 0!==s)return s.exports;var i=n[e]={exports:{}},l=!0;try{t[e](i,i.exports,r),l=!1}finally{l&&delete n[e]}return i.exports}r.ab="//";var s=r(229);e.exports=s}()}},function(e){e.O(0,[917,971,23,744],function(){return e(e.s=7526)}),_N_E=e.O()}]);