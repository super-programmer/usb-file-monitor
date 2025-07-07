/*
 * @Author: 周克朋 15538308935@163.com
 * @Date: 2025-02-17 20:39:51
 * @LastEditors: 周克朋 15538308935@163.com
 * @LastEditTime: 2025-07-07 15:56:16
 * @FilePath: \usb-file-monitor\src\index.js
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
const { BrowserWindow, ipcMain, clipboard } = require("electron");
const path = require("path");
const { WebUSB } = require("usb");
const remote = require("@electron/remote/main");
const chokidar = require("chokidar");
const fs = require("fs");
const { exec } = require("child_process");
const { MongoClient } = require("mongodb");
const iconv = require("iconv-lite");
const { log } = require("console");
const { buffer } = require("stream/consumers");
// 正常情况
let mainWindow;
let watcher;

// 获取可移动磁盘路径
async function getRemovableDiskPaths() {
    const tempDir = path.join(require("os").tmpdir(), "usb-scripts");
    const scriptFile = path.join(tempDir, "usb-script.ps1");
    const outputFile = path.join(tempDir, "usb-devices.json");
    const doneFile = `${outputFile}.done`; // 完成标记文件

    // 确保临时目录存在
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    // 构建PowerShell脚本内容，使用UTF8-BOM编码解决中文问题
    const powerShellScript = `
        # 设置控制台输出编码为UTF8
        $OutputEncoding = [System.Text.Encoding]::UTF8
        [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
        
        try {
            if (-not (Test-Path '${tempDir}')) {
                New-Item -ItemType Directory -Path '${tempDir}' | Out-Null;
            }
            $devices = @();
            $usbStorageDevices = Get-WmiObject -Class Win32_DiskDrive | Where-Object { $_.InterfaceType -eq "USB" };
            foreach ($device in $usbStorageDevices) {
                $partitions = Get-WmiObject -Query "ASSOCIATORS OF {Win32_DiskDrive.DeviceID='$($device.DeviceID)'} WHERE AssocClass = Win32_DiskDriveToDiskPartition";
                foreach ($partition in $partitions) {
                    $logicalDisks = Get-WmiObject -Query "ASSOCIATORS OF {Win32_DiskPartition.DeviceID='$($partition.DeviceID)'} WHERE AssocClass = Win32_LogicalDiskToPartition";
                    foreach ($logicalDisk in $logicalDisks) {
                         $devices += @{
                            Type = 'USB存储设备';
                            Name = $device.Model;
                            Description = $device.Description;
                            Status = if ($device.Status -eq 'OK') { '正常' } else { $device.Status };
                            DeviceID = $device.DeviceID;
                            Manufacturer = $device.Manufacturer;
                            DriveLetter = $logicalDisk.DeviceID;
                            Size = [math]::Round($logicalDisk.Size / 1GB, 2);
                            FreeSpace = [math]::Round($logicalDisk.FreeSpace / 1GB, 2);
                            SizeGB = "$([math]::Round($logicalDisk.Size / 1GB, 2)) GB";
                            FreeSpaceGB = "$([math]::Round($logicalDisk.FreeSpace / 1GB, 2)) GB"
                        };
                    }
                }
            }
            if ($devices.Count -gt 0) {
                $jsonOutput = ConvertTo-Json -InputObject $devices -Depth 3 -Compress;
            } else {
                $jsonOutput = '[]';
            }
            
            # 使用UTF8-BOM编码写入文件
            $utf8WithBom = New-Object System.Text.UTF8Encoding($true)
            [System.IO.File]::WriteAllLines('${outputFile}', $jsonOutput, $utf8WithBom)
            
            # 创建完成标记文件
            New-Item -ItemType File -Path '${doneFile}' -Force | Out-Null
            
            if (Test-Path '${outputFile}') {
                Write-Host '文件写入成功';
            } else {
                throw '文件写入失败';
            }
        } catch {
            Write-Error $_.Exception.Message;
            exit 1;
        }
    `;

    try {
        // 使用UTF8带BOM编码保存PowerShell脚本
        const utf8WithBom = Buffer.from([0xef, 0xbb, 0xbf]);
        const scriptBuffer = Buffer.concat([
            utf8WithBom,
            Buffer.from(powerShellScript, "utf8")
        ]);
        fs.writeFileSync(scriptFile, scriptBuffer);
        logger.log(`PowerShell脚本已保存到: ${scriptFile}`);
    } catch (err) {
        logger.error(`创建PowerShell脚本失败: ${err}`);
        return [];
    }

    // 使用spawn替代exec，更好地控制子进程
    const { spawn } = require("child_process");
    const powershellArgs = [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        `"${scriptFile}"`
    ];

    const child = spawn("powershell", powershellArgs, {
        shell: process.env.ComSpec,
        windowsHide: false
    });

    let stdout = "";
    let stderr = "";

    return new Promise((resolve, reject) => {
        child.stdout.on("data", (data) => {
            logger.log(data.toString());
            stdout += data.toString();
        });

        child.stderr.on("data", (data) => {
            stderr += data.toString();
        });

        child.on("close", async(code) => {
            logger.log(`code:${code}`);
            if (code !== 0) {
                logger.error(`PowerShell进程异常退出，退出码: ${code}`);
                logger.error(`错误信息: ${stderr}`);
                reject(new Error(`PowerShell执行失败: ${stderr || "未知错误"}`));
                return;
            }

            try {
                // 等待完成标记文件出现，最多等待5秒
                const startTime = Date.now();
                while (!fs.existsSync(doneFile) && Date.now() - startTime < 5000) {
                    await new Promise((res) => setTimeout(res, 100));
                }

                if (!fs.existsSync(doneFile)) {
                    throw new Error("等待文件完成超时");
                }

                logger.log(`文件已就绪，开始读取: ${outputFile}`);

                // 读取文件前先删除完成标记
                fs.unlinkSync(doneFile);

                // 读取文件内容
                const fileContent = fs.readFileSync(outputFile, {
                    encoding: "utf8",
                    flag: "r"
                });

                // 检查文件内容是否为空
                if (!fileContent.trim()) {
                    // 给系统一些时间完成文件写入
                    await new Promise((res) => setTimeout(res, 500));
                    const retryContent = fs.readFileSync(outputFile, {
                        encoding: "utf8",
                        flag: "r"
                    });
                    if (!retryContent.trim()) {
                        throw new Error("文件内容为空");
                    }
                    // 使用重试读取的内容
                    fileContent = retryContent;
                }

                // 处理文件内容
                const cleanedContent = fileContent.replace(/^\uFEFF/, "").trim();
                logger.log(`文件内容预览: ${cleanedContent.substring(0, 100)}...`);
                const devices = JSON.parse(cleanedContent);
                // 将移动磁盘信息发送值页面渲染
                mainWindow.webContents.send("usb-status-data", devices);
                // 解析JSON
                const paths = devices.map((item) => item.DriveLetter);

                resolve(paths);
            } catch (e) {
                logger.error(`处理可移动磁盘路径信息失败: ${e}`);
                reject(e);
            } finally {
                // 清理临时文件
                try {
                    logger.log("清理临时文件开始");
                    if (fs.existsSync(outputFile)) {
                        // fs.unlinkSync(outputFile);
                    }
                    if (fs.existsSync(scriptFile)) {
                        // fs.unlinkSync(scriptFile);
                    }
                    if (fs.existsSync(doneFile)) {
                        fs.unlinkSync(doneFile);
                    }
                } catch (e) {
                    logger.warn("清理临时文件失败:", e);
                }
            }
        });
    });
}

// 监控文件变化
async function startFileWatcher() {
    const os = require("os");
    // 获取当前用户名
    const computerUsername = os.userInfo().username;
    logger.info(computerUsername);
    // 从渲染进程获取 localStorage 中的 username
    const localStorageUsername = await new Promise((resolve) => {
        mainWindow.webContents.send("get-localstorage-username");
        ipcMain.once("localstorage-username", (event, username) => {
            resolve(username);
        });
    });
    // 获取本地 MAC 地址
    let macAddress = getMacAddress(os);
    const paths = await getRemovableDiskPaths();
    logger.info(`移动磁盘路径: ${paths}`);
    if (paths.length === 0) {
        log("未找到移动磁盘，无法开始文件监听");
        return;
    }

    // 如果已存在watcher，先关闭它
    if (watcher) {
        watcher.close();
    }

    watcher = chokidar.watch(paths, {
        ignored: /(^|[\/\\])\../, // 忽略隐藏文件
        persistent: true,
        ignoreInitial: true
            // usePolling: true
    });
    // 单位换算函数
    function convertFileSize(bytes) {
        if (bytes < 1024) {
            return bytes + " B";
        } else if (bytes < 1024 * 1024) {
            return (bytes / 1024).toFixed(2) + " KB";
        } else if (bytes < 1024 * 1024 * 1024) {
            return (bytes / (1024 * 1024)).toFixed(2) + " MB";
        } else if (bytes < 1024 * 1024 * 1024 * 1024) {
            return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
        } else {
            return (bytes / (1024 * 1024 * 1024 * 1024)).toFixed(2) + " TB";
        }
    }

    // 处理文件变更事件
    const handleFileChange = async(type, filePath, stats) => {
        try {
            const change = {
                type,
                filePath,
                // 计算机唯一标识
                name: path.basename(filePath),
                // 使用单位换算函数
                size: convertFileSize(stats ? stats.size : 0),
                macAddress,
                // 时间取当前时间格式化为年月日加时分秒
                time: new Date().toLocaleString(),
                userName: `${computerUsername}-${localStorageUsername}`,
                details: `文件${
          type === "add" ? "新增" : type === "change" ? "修改" : "删除"
        }`
            };

            // 保存到数据库
            await saveFileChange(change);

            // 发送到渲染进程
            mainWindow.webContents.send("file-changes-data", [change]);
        } catch (error) {
            console.error("处理文件变更失败:", error);
        }
    };

    // 监听文件事件
    watcher.on("add", async(path, stats) => {
        log(`文件新增: ${path}`);
        await handleFileChange("add", path, stats);
    });
    watcher.on("change", async(path, stats) => {
        log(`文件修改: ${path}`);
        await handleFileChange("change", path, stats);
    });
    watcher.on("unlink", async(path) => {
        log(`文件删除: ${path}`);
        await handleFileChange("unlink", path);
    });
    // 监听错误事件
    watcher.on("error", (error) => log(`Watcher error: ${error}`));
    // 监听准备就绪事件
    watcher.on("ready", () => log("Initial scan complete. Ready for changes"));
    // 添加 IPC 监听器
    ipcMain.on("get-file-changes", async(event, { page, limit, filter }) => {
        log(page, limit, filter);
        const history = await getFileChanges(page, limit, filter);
        mainWindow.webContents.send("file-changes-response", {
            success: !!history,
            data: history
        });
    });

    return watcher;
}

function getMacAddress(os) {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (!iface.internal && iface.family === "IPv4") {
                return iface.mac;
            }
        }
    }
    return "Unknown";
}
async function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        icon: path.join(__dirname, "../src/static/images/file-management-icon.png"),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true
        },
        frame: false, // 无边框窗口
        resizable: true,
        transparent: false // 支持透明
    });
    // 设置正确的字符编码
    mainWindow.webContents.on("did-finish-load", () => {
        mainWindow.webContents.setZoomFactor(1);
        mainWindow.webContents.send("set-language", "zh-CN");
    });
    // 添加窗口控制事件处理
    ipcMain.on("window-min", () => {
        mainWindow.minimize();
    });

    ipcMain.on("window-max", () => {
        if (mainWindow.isMaximized()) {
            mainWindow.restore();
        } else {
            mainWindow.maximize();
        }
    });

    ipcMain.on("window-close", () => {
        mainWindow.close();
    });

    // Enable the remote module for this window's webContents
    // remote.enable(mainWindow.webContents);
    mainWindow.loadFile(path.join(__dirname, "index.html"));
    // const customWebUSB = new WebUSB({
    //     // Bypass checking for authorised devices
    //     allowAllDevices: true
    // });
    await startFileWatcher();
    // Uses blocking calls, so is async
    // const devices = await customWebUSB.getDevices();
    // mainWindow.webContents.send(
    //     "usb-attached",
    //     devices.map((device) => {
    //         return {
    //             vid: device.vendorId,
    //             pid: device.productId,
    //             productName: device.productName,
    //             manufacturerName: device.manufacturerName
    //         };
    //     })
    // );
}

// MongoDB 连接配置
const mongoConfig = {
    url: "mongodb://localhost:27017",
    dbName: "usbMonitor",
    options: {
        // useNewUrlParser: true,
        // useUnifiedTopology: true
    }
};

// 修改控制台输出处理函数
function formatloggerMessage(message, type = "log") {
    const iconv = require("iconv-lite");

    try {
        let formattedMessage = "";
        const timestamp = new Date().toLocaleTimeString();
        const prefix = type === "error" ? "错误" : "信息";

        // 处理不同类型的消息
        if (Buffer.isBuffer(message)) {
            formattedMessage = iconv.decode(message, "gbk");
        } else if (typeof message === "object" && message !== null) {
            if (message instanceof Error) {
                formattedMessage = message.message || message.toString();
            } else {
                formattedMessage = JSON.stringify(message, null, 2);
            }
        } else if (typeof message === "string") {
            formattedMessage = message;
        }

        // 使用 GBK 编码输出
        const outputMessage = `[${timestamp}] [${prefix}] ${formattedMessage}\n`;
        const outputBuffer = iconv.encode(outputMessage, "gbk");

        if (type === "error") {
            process.stderr.write(outputBuffer);
        } else {
            process.stdout.write(outputBuffer);
        }
    } catch (err) {
        process.stderr.write(
            iconv.encode(`日志格式化失败: ${err.toString()}\n`, "gbk")
        );
    }
}

// 创建自定义日志函数
const logger = {
    log: (message) => formatloggerMessage(message, "log"),
    error: (message) => formatloggerMessage(message, "error"),
    info: (message) => formatloggerMessage(message, "log"),
    warn: (message) => formatloggerMessage(message, "error")
};

// 修改 MongoDB 连接函数
async function connectToMongo() {
    try {
        const client = await MongoClient.connect(
            mongoConfig.url,
            mongoConfig.options
        );
        const db = client.db(mongoConfig.dbName);
        logger.info("MongoDB连接成功");
        return { client, db };
    } catch (error) {
        logger.error(`MongoDB连接失败: ${error.message}`);
        return null;
    }
}
/**
 * 获取数据库连接
 * @returns {Object} - 数据库连接对象
 */
function getDatabaseConnection() {
    const sqlite3 = require("sqlite3").verbose();
    const path = require("path");

    // 数据库文件路径
    const dbPath = path.join(__dirname, "usb_devices.db");

    // 创建数据库连接
    const db = new sqlite3.Database(dbPath, (err) => {
        if (err) {
            logger.error(`数据库连接失败: ${err.message}`);
            throw err;
        }
        logger.log("数据库连接成功");

        // 确保表存在
        db.serialize(() => {
            db.run(`
                CREATE TABLE IF NOT EXISTS usb_devices (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    deviceId TEXT UNIQUE,
                    type TEXT,
                    name TEXT,
                    description TEXT,
                    manufacturer TEXT,
                    status TEXT,
                    driveLetter TEXT,
                    size REAL,
                    freeSpace REAL,
                    sizeGB TEXT,
                    freeSpaceGB TEXT,
                    createdAt TIMESTAMP,
                    updatedAt TIMESTAMP
                )
            `);
        });
    });

    // 扩展数据库对象，添加需要的方法
    return {
        // 开始事务
        async beginTransaction() {
            return new Promise((resolve, reject) => {
                db.run("BEGIN TRANSACTION", (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        },

        // 提交事务
        async commit() {
            return new Promise((resolve, reject) => {
                db.run("COMMIT", (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        },

        // 回滚事务
        async rollback() {
            return new Promise((resolve, reject) => {
                db.run("ROLLBACK", (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        },

        // 查找单条记录
        async findOne(options) {
            const { table, where } = options;
            const keys = Object.keys(where);
            const values = Object.values(where);
            const conditions = keys.map((key) => `${key} = ?`).join(" AND ");

            const query = `SELECT * FROM ${table} WHERE ${conditions}`;

            return new Promise((resolve, reject) => {
                db.get(query, values, (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
        },

        // 插入记录
        async insert(options) {
            const { table, data } = options;
            const keys = Object.keys(data);
            const values = Object.values(data);
            const placeholders = keys.map(() => "?").join(",");

            const query = `INSERT INTO ${table} (${keys.join(
        ","
      )}) VALUES (${placeholders})`;

            return new Promise((resolve, reject) => {
                db.run(query, values, function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                });
            });
        },

        // 更新记录
        async update(options) {
            const { table, where, data } = options;
            const setKeys = Object.keys(data);
            const setValues = Object.values(data);
            const whereKeys = Object.keys(where);
            const whereValues = Object.values(where);

            const setConditions = setKeys.map((key) => `${key} = ?`).join(", ");
            const whereConditions = whereKeys
                .map((key) => `${key} = ?`)
                .join(" AND ");

            const query = `UPDATE ${table} SET ${setConditions} WHERE ${whereConditions}`;
            const allValues = [...setValues, ...whereValues];

            return new Promise((resolve, reject) => {
                db.run(query, allValues, function(err) {
                    if (err) reject(err);
                    else resolve(this.changes);
                });
            });
        },

        // 关闭数据库连接
        close() {
            db.close((err) => {
                if (err) {
                    logger.error(`数据库关闭失败: ${err.message}`);
                } else {
                    logger.log("数据库连接已关闭");
                }
            });
        }
    };
}
/**
 * 保存USB设备信息到数据库
 * 如果设备已存在则更新，不存在则添加
 * @param {Array} devices - 设备信息数组
 * @returns {Promise<boolean>} - 保存成功返回true，失败返回false
 */
async function saveUSBDevices(devices) {
    try {
        // 确保传入的是数组
        if (!Array.isArray(devices) || devices.length === 0) {
            logger.log("没有设备需要保存");
            return false;
        }

        logger.log(`开始保存 ${devices.length} 个USB设备信息`);

        // 假设我们有一个数据库连接或存储方法
        // 这里使用一个通用的数据库操作函数，实际使用时需要替换为你自己的数据库操作
        // const db = getDatabaseConnection(); // 这个函数需要你自己实现
        const { db } = await connectToMongo();
        logger.log(`数据库连接成功${db}`);
        // 开始事务（如果支持）
        await db.beginTransaction();

        // 处理每个设备
        for (const device of devices) {
            // 检查设备是否已存在
            const existingDevice = await db.findOne({
                table: "usb_devices",
                where: { deviceId: device.deviceId }
            });

            if (existingDevice) {
                // 设备已存在，更新信息
                logger.log(`更新现有设备: ${device.name} (${device.deviceId})`);

                await db.update({
                    table: "usb_devices",
                    where: { deviceId: device.deviceId },
                    data: {
                        type: device.type,
                        name: device.name,
                        description: device.description,
                        manufacturer: device.manufacturer,
                        status: device.status,
                        driveLetter: device.driveLetter,
                        size: device.size,
                        freeSpace: device.freeSpace,
                        sizeGB: device.sizeGB,
                        freeSpaceGB: device.freeSpaceGB,
                        updatedAt: new Date()
                    }
                });
            } else {
                // 设备不存在，添加新记录
                logger.log(`添加新设备: ${device.name} (${device.deviceId})`);

                await db.insert({
                    table: "usb_devices",
                    data: {
                        deviceId: device.deviceId,
                        type: device.type,
                        name: device.name,
                        description: device.description,
                        manufacturer: device.manufacturer,
                        status: device.status,
                        driveLetter: device.driveLetter,
                        size: device.size,
                        freeSpace: device.freeSpace,
                        sizeGB: device.sizeGB,
                        freeSpaceGB: device.freeSpaceGB,
                        createdAt: new Date(),
                        updatedAt: new Date()
                    }
                });
            }
        }

        // 提交事务
        await db.commit();

        logger.log(`成功保存 ${devices.length} 个USB设备信息`);
        return true;
    } catch (error) {
        // 发生错误，回滚事务（如果支持）
        if (db && db.rollback) {
            await db.rollback();
        }

        logger.error(`保存USB设备信息失败111: ${error.message}`);
        return false;
    }
}

// 查询 USB 设备历史记录
async function getUSBDeviceHistory() {
    try {
        const { client, db } = await connectToMongo();
        if (!db) return null;

        const collection = db.collection("usbDevices");

        // 获取最近100条记录
        const history = await collection
            .find()
            .sort({ timestamp: -1 })
            .limit(100)
            .toArray();

        await client.close();
        return history;
    } catch (error) {
        logger.error("获取USB设备历史记录失败:", error);
        return null;
    }
}

// 添加 IPC 监听器获取历史记录
ipcMain.on("get-usb-history", async() => {
    const history = await getUSBDeviceHistory();
    mainWindow.webContents.send("usb-history-response", {
        success: !!history,
        history: history || []
    });
});

// 文件变更记录相关函数
async function saveFileChange(change) {
    try {
        const { client, db } = await connectToMongo();
        if (!db) return false;

        const collection = db.collection("fileChanges");

        // 创建变更记录
        const timestamp = new Date();
        const changeRecord = {
            changeId: timestamp.getTime().toString(),
            timestamp,
            recordDate: timestamp.toLocaleDateString("zh-CN"),
            recordTime: timestamp.toLocaleTimeString("zh-CN"),
            type: change.type, // 'add' | 'change' | 'unlink'
            filePath: change.filePath,
            fileName: require("path").basename(change.filePath),
            fileDir: require("path").dirname(change.filePath),
            details: change.details || "",
            fileStats: change.stats || null
        };

        await collection.insertOne(changeRecord);
        logger.log("文件变更记录已保存");

        await client.close();
        return true;
    } catch (error) {
        console.error("保存文件变更记录失败:", error);
        return false;
    }
}

// 获取文件变更历史
async function getFileChanges(page = 1, limit = 10, filter = {}) {
    try {
        const { client, db } = await connectToMongo();
        logger.log(db);
        if (!db) return null;

        const collection = db.collection("fileChanges");

        // 构建查询条件
        const query = {};
        if (filter.type) query.type = filter.type;
        if (filter.fileName) query.fileName = new RegExp(filter.fileName, "i");
        if (filter.startDate && filter.endDate) {
            query.timestamp = {
                $gte: new Date(filter.startDate),
                $lte: new Date(filter.endDate)
            };
        }

        const total = await collection.countDocuments(query);
        const changes = await collection
            .find(query)
            .sort({ timestamp: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .toArray();

        await client.close();
        logger.log(changes);
        return {
            total,
            changes,
            currentPage: page,
            totalPages: Math.ceil(total / limit)
        };
    } catch (error) {
        console.error("获取文件变更历史失败:", error);
        return null;
    }
}

module.exports = { createWindow };