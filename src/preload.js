/*
 * @Author: 周克朋 15538308935@163.com
 * @Date: 2025-02-17 20:39:51
 * @LastEditors: 周克朋 15538308935@163.com
 * @LastEditTime: 2025-03-13 16:35:11
 * @FilePath: \usb-file-monitor\src\preload.js
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

// const usb = require("usb");

// window.addEventListener("DOMContentLoaded", () => {
//     // Expose usb to renderer process
//     window.usb = usb;
// });

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electron", {
  ipcRenderer: {
    send: (channel, data) => ipcRenderer.send(channel, data),
    on: (channel, func) => {
      ipcRenderer.on(channel, (event, ...args) => func(...args));
    },
    invoke: (channel, data) => ipcRenderer.invoke(channel, data)
  }
});
