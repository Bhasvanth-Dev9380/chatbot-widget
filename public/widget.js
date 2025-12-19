(function(){"use strict";const d={WIDGET_URL:"https://chatbot-widget-flax-one.vercel.app",DEFAULT_POSITION:"bottom-right"},E=`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="white" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
</svg>`,L=`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <line x1="18" y1="6" x2="6" y2="18"></line>
  <line x1="6" y1="6" x2="18" y2="18"></line>
</svg>`;(function(){let s=null,e=null,t=null,c=!1,p=null,r=null,l=null,a=d.DEFAULT_POSITION,m="#3b82f6";const h=document.currentScript;if(h)r=h.getAttribute("data-organization-id"),l=h.getAttribute("data-chatbot-id"),a=h.getAttribute("data-position")||d.DEFAULT_POSITION,console.log("[Embed] Got attributes from currentScript:",{organizationId:r,chatbotId:l,position:a});else{const i=document.querySelectorAll('script[src*="widget"]'),n=Array.from(i).find(o=>o.hasAttribute("data-organization-id"));n&&(r=n.getAttribute("data-organization-id"),l=n.getAttribute("data-chatbot-id"),a=n.getAttribute("data-position")||d.DEFAULT_POSITION,console.log("[Embed] Got attributes from fallback script:",{organizationId:r,chatbotId:l,position:a}))}if(!r){console.error("Echo Widget: data-organization-id attribute is required");return}function f(){document.readyState==="loading"?document.addEventListener("DOMContentLoaded",b):b()}function b(){t=document.createElement("button"),t.id="echo-widget-button",t.style.cssText=`
      position: fixed;
      ${a==="bottom-right"?"right: 24px;":"left: 24px;"}
      bottom: 24px;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: #3b82f6;
      color: white;
      border: none;
      cursor: pointer;
      z-index: 999999;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 24px rgba(59, 130, 246, 0.35);
      transition: all 0.3s ease;
      opacity: 1;
      visibility: visible;
    `,t.addEventListener("click",k),t.addEventListener("mouseenter",()=>{t&&(t.style.transform="scale(1.05)")}),t.addEventListener("mouseleave",()=>{t&&(t.style.transform="scale(1)")}),g(),document.body.appendChild(t),e=document.createElement("div"),e.id="echo-widget-container",e.style.cssText=`
      position: fixed;
      ${a==="bottom-right"?"right: 24px;":"left: 24px;"}
      bottom: 88px;
      width: 418px;
      height: 510px;
      max-width: calc(100vw - 48px);
      max-height: calc(100vh - 120px);
      z-index: 999998;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.15);
      display: none;
      opacity: 0;
      transform: translateY(10px);
      transition: all 0.3s ease;
    `,s=document.createElement("iframe"),s.src=T(),s.style.cssText=`
      width: 100%;
      height: 100%;
      border: none;
    `,s.allow="microphone; clipboard-read; clipboard-write",e.appendChild(s),document.body.appendChild(e),window.addEventListener("message",y)}function T(){const i=new URLSearchParams;i.append("organizationId",r),l&&i.append("chatbotId",l),i.append("_t",Date.now().toString());const n=`${d.WIDGET_URL}?${i.toString()}`;return console.log("[Embed] Building widget URL:",n),n}function y(i){if(i.origin!==new URL(d.WIDGET_URL).origin)return;const{type:n,payload:o}=i.data;switch(n){case"close":u();break;case"resize":o.height&&e&&(e.style.height=`${o.height}px`),o.width&&e&&(e.style.width=`${o.width}px`);break;case"updateAppearance":if(o.primaryColor&&t&&(m=o.primaryColor,t.style.background=o.primaryColor),o.launcherIconUrl!==void 0&&(p=o.launcherIconUrl,c||g()),o.size&&e){const v={small:{width:"368px",height:"460px"},medium:{width:"418px",height:"510px"},large:{width:"468px",height:"560px"}},I=v[o.size]||v.medium;e.style.width=I.width,e.style.height=I.height}t&&(t.style.opacity="1",t.style.visibility="visible");break}}function k(){c?u():x()}function x(){e&&t&&(c=!0,e.style.display="block",setTimeout(()=>{e&&(e.style.opacity="1",e.style.transform="translateY(0)")},10),t.innerHTML=L)}function u(){e&&t&&(c=!1,e.style.opacity="0",e.style.transform="translateY(10px)",setTimeout(()=>{e&&(e.style.display="none")},300),g(),t.style.background=m)}function g(){if(t)if(p){t.innerHTML="";const i=document.createElement("img");i.src=p,i.alt="Open chat",i.style.maxWidth="60%",i.style.maxHeight="60%",i.style.objectFit="contain",t.appendChild(i)}else t.innerHTML=E}function w(){window.removeEventListener("message",y),e&&(e.remove(),e=null,s=null),t&&(t.remove(),t=null),c=!1}function z(i){w(),i.organizationId&&(r=i.organizationId),i.chatbotId&&(l=i.chatbotId),i.position&&(a=i.position),f()}window.EchoWidget={init:z,show:x,hide:u,destroy:w},f()})()})();