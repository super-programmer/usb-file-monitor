/*
 * @Author: 周克�? 15538308935@163.com
 * @Date: 2025-02-17 22:34:07
 * @LastEditors: 周克朋 15538308935@163.com
 * @LastEditTime: 2025-05-13 14:47:32
 * @FilePath: \usb-file-monitor\src\renderer.js
 * @Description: 这是默�?��?�置,请�?�置`customMade`, 打开koroFileHeader查看配置 进�?��?�置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
// renderer.js
const { ipcRenderer } = require("electron");

ipcRenderer.on("file-change", (_, { type, path }) => {
    const listItem = document.createElement("li");
    listItem.textContent = `${new Date().toLocaleString()} ${type}: ${path}`;
    document.getElementById("file-list").appendChild(listItem);
});

let usbEnabled = true;
const statusElement = document.getElementById("usb-status");
const toggleButton = document.getElementsByClassName("enable-usb")[0];

// 更新 UI 显示
function updateUIStatus(enabled) {
    console.log(toggleButton);
    statusElement.textContent = enabled ? "已启USB" : "已USB禁用";
    statusElement.style.color = enabled ? "green" : "red";
    toggleButton.textContent = enabled ? "禁用USB" : "启用USB";
}

// 切换 USB 状�?
window.toggleUSB = function() {
    usbEnabled = !usbEnabled;
    ipcRenderer.send("toggle-usb", usbEnabled);
};

// 监听主进程返回的操作结果
ipcRenderer.on("usb-toggle-response", (event, response) => {
    if (response.success) {
        updateUIStatus(response.enabled);
    } else {
        alert("操作失败�?" + response.error);
        // 操作失败时恢复状�?
        usbEnabled = !usbEnabled;
        updateUIStatus(usbEnabled);
    }
});

// 页面加载时获取初始状�?
ipcRenderer.send("get-usb-status");
ipcRenderer.on("usb-status", (event, enabled) => {
    usbEnabled = enabled;
    updateUIStatus(enabled);
});

// 请求获取 USB 设�?�列�?
ipcRenderer.send("get-usb-devices");
ipcRenderer.on("usb-devices-response", (event, response) => {
    if (response.success) {
        const deviceListElement = document.getElementById("usb-status");
        deviceListElement.innerHTML = "";

        // 先显示控制器
        const controllers = response.devices.filter(
            (device) => device.type === "控制�?"
        );
        const ports = response.devices.filter((device) => device.type === "�?�?");

        // 显示控制器信�?
        if (controllers.length > 0) {
            const controllerSection = document.createElement("div");
            controllerSection.innerHTML = "<h2>USB控制�?</h2>";
            controllers.forEach((controller) => {
                const element = document.createElement("div");
                element.className = "device-item controller";
                element.innerHTML = `
                    <h3>${controller.name}</h3>
                    <p>描述: ${controller.description}</p>
                    <p>状�?: <span class="status-${
                      controller.status === "正常" ? "ok" : "error"
                    }">${controller.status}</span></p>
                    <p>制造商: ${controller.manufacturer}</p>
                    <p>位置: ${controller.location}</p>
                    <p>�?口数�?: ${controller.portCount}</p>
                `;
                controllerSection.appendChild(element);
            });
            deviceListElement.appendChild(controllerSection);
        }

        // 显示�?口信�?
        if (ports.length > 0) {
            const portSection = document.createElement("div");
            portSection.innerHTML = "<h2>USB�?�?</h2>";
            ports.forEach((port) => {
                const element = document.createElement("div");
                element.className = "device-item port";
                element.innerHTML = `
                    <h3>${port.name}</h3>
                    <p>描述: ${port.description}</p>
                    <p>状�?: <span class="status-${
                      port.status === "正常" ? "ok" : "error"
                    }">${port.status}</span></p>
                    <p>制造商: ${port.manufacturer}</p>
                    <p>位置: ${port.location}</p>
                    <p>总线�?: ${port.busNumber}</p>
                    <p>�?否为集线�?: ${port.isHub}</p>
                    <p>使用状�?: ${port.inUse}</p>
                `;
                portSection.appendChild(element);
            });
            deviceListElement.appendChild(portSection);
        }
    }
});
// 监听响应
// ipcRenderer.on("usb-devices-response", (event, response) => {
//     const { success, devices } = response;
//     console.log(devices);
//     if (success) {
//         const str = devices.reduce((acc, device) => {
//             return (
//                 acc +
//                 `<br/> (INSTANCEID: ${device.instanceId},产品名称: ${device.friendlyName}, 制造商名称: ${device.manufacturer}) `
//             );
//         }, "");
//         document.getElementById("usb-status").innerHTML = `已连接�?��??:${str}`;
//     } else {
//         console.error("获取USB设�?�失�?:", response.error);
//     }
// });