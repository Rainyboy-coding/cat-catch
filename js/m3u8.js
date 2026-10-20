// url 参数解析
const params = new URL(location.href).searchParams;
let _m3u8Url = params.get("url");   // m3u8的url地址
const _requestHeaders = params.get("requestHeaders");   // 自定义请求头
const _initiator = params.get("initiator"); // referer 备用
const _title = params.get("title"); // 来源网页标题
const _fileName = params.get("filename");   // 自定义文件名
let tsAddArg = params.get("tsAddArg");  // 自定义 切片参数
let autoReferer = params.get("autoReferer");    // 是否已经自动调整 referer
const tabId = parseInt(params.get("tabid"));    // 资源所在的标签页ID 用来获取密钥
const _autoDown = params.get("autoDown");  //是否自动下载
let autoDown = params.get("autoDown");  //是否自动下载
const autoClose = params.get("autoClose");  // 下载完是否关闭页面
let retryCount = parseInt(params.get("retryCount"));  // 重试次数
const _getMpdId = parseInt(params.get("getMpdId"));  // 从mpd页面传入的 m3u8 解析

const _isMaster = params.get("isMaster");   // 是否为主任务

let currentTabId = 0;   // 本页面tab Id
let currentIndex = 0;   // 本页面Index

/*
*   popup 合并多个m3u8 需要提交以下参数 ffmpeg才能判断文件是否添加完毕
*   _ffmpeg 参数为ffmpeg动作 例如: "merge"为合并
*   _quantity: m3u8数量
*   _taskId: 唯一任务ID
**/
const _ffmpeg = params.get("ffmpeg");   // 是否发送到 ffmpeg
const _quantity = params.get("quantity");   // 同时下载的总数
const _taskId = params.get("taskId");   // 任务id

// 修改当前标签下的所有xhr的Referer 修改完成 运行init函数
const requestHeaders = JSONparse(_requestHeaders);
// 当前资源数据
let _data = {
    url: _m3u8Url,
    title: _title ?? "NULL",
};
setRequestHeaders(requestHeaders, () => {
    chrome.tabs.getCurrent(function (tab) {
        currentIndex = tab.index;
        currentTabId = tab.id;
        if (tabId && tabId != -1) {
            chrome.runtime.sendMessage(chrome.runtime.id, { Message: "getData", tabId: tabId }, (data) => {
                if (chrome.runtime.lastError) {
                    awaitG(init);
                    return;
                }
                if (data) {
                    data = data.find(item => item.url == _m3u8Url);
                    _data = data ?? _data;
                }
                awaitG(init);
            });
        } else {
            awaitG(init);
        }
    });
});


/* m3u8 解析工具 */
const hls = new Hls({
    enableWorker: false,
    debug: false
});  // hls.js 对象
const _fragments = []; // 储存切片对象
const keyContent = new Map(); // 储存key的内容
const initData = new Map(); // 储存map的url
const decryptor = new AESDecryptor(); // 解密工具 来自hls.js 分离出来的
let downId = 0; // chrome下载api 回调id
let currentLevel = -1;  // 当前Level
let estimateFileSize = 0; // 估算的文件最终大小

let downDuration = 0; // 下载媒体得时长


let fileStream = undefined; // 流式下载文件输出流
const downSet = {};   // 下载时 储存设置
// 下载选项 固定默认值
const opt = {
    mp4: true,  // 转为mp4
    StreamSaver: true,  // 边下边存
    ffmpeg: false,  // 在线ffmpeg转码
    dataPreprocessing: false,   // 数据预处理 切片伪装成图片时剔除图片数据
    saveAs: false,  // 另存为
    autoClose: false,   // 下载完自动关闭页面
};

/* 录制相关 */
let recorder = false; // 开关
let recorderLast = "";  // 最后下载的url


/* mp4 转码工具 */
let transmuxer = undefined;

/* DOM */
const $fileSize = $("#fileSize");   // 下载文件大小 进度
const $progress = $("#progress");   // 下载进度
const $fileDuration = $("#fileDuration");   // 下载总时长

// 自动合并
let autoMergeTimer = null;

/**
 * 初始化函数，界面默认配置 loadSource载入 m3u8 url
 */
function init() {
    // 获取页面DOM
    if (tabId && tabId != -1) {
        chrome.tabs.sendMessage(parseInt(tabId), { Message: "getPage" }, { frameId: 0 }, function (result) {
            if (chrome.runtime.lastError) { return; }
            _data.pageDOM = new DOMParser().parseFromString(result, 'text/html');
        });
    }
    loadCSS();

    // 隐藏firefox 不支持的功能
    G.isFirefox && $(".firefoxHide").each(function () { $(this).hide(); });

    // 下载选项
    opt.autoClose = autoClose == 1;
    opt.saveAs = !!G.saveAs;
    // 发送到ffmpeg取消边下边存设置
    _ffmpeg && (opt.StreamSaver = false);

    // 解码 切片URL参数
    if (tsAddArg != null) {
        tsAddArg = decodeURIComponent(tsAddArg);
    }

    if (isEmpty(_m3u8Url) || _getMpdId) {
        $("#loading").hide(); $("#m3u8Custom").show();

        $("#uploadM3U8").change(function (event) {
            const file = event.target.files[0];
            const reader = new FileReader();
            reader.onload = () => {
                $("#m3u8Text").val(reader.result)
            };
            reader.readAsText(file);
        });

        $("#parse").click(async function () {
            let m3u8Text = $("#m3u8Text").val().trim();
            let baseUrl = $("#baseUrl").val().trim();
            let referer = $("#referer").val().trim();
            if (referer) {
                if (referer.startsWith("http")) {
                    setRequestHeaders({ referer: referer });
                } else {
                    setRequestHeaders(JSONparse(referer));
                }
            }

            if (m3u8Text == "") { return; }

            // 批量生成切片链接 解析range标签
            if (m3u8Text.includes('${range:')) {
                const rangePattern = /\$\{range:(\d+)-(\d+|\?),?(\d+)?\}/g;
                const matches = [...m3u8Text.matchAll(rangePattern)];
                if (!matches.length) return;

                const tags = matches.map(m => ({
                    start: parseInt(m[1]),
                    end: m[2] === '?' ? Infinity : parseInt(m[2]),
                    pad: m[3] ? parseInt(m[3]) : 0,
                    isOpen: m[2] === '?'
                }));

                const hasOpen = tags.some(t => t.isOpen);
                const urls = [];
                const generatedSet = new Set();
                let n = 0;
                const maxUrls = 9999;

                $("#m3u8Text").val(i18n.loadingData);

                while (urls.length < maxUrls) {
                    const values = tags.map(t => {
                        if (t.isOpen) {
                            return (t.start + n).toString().padStart(t.pad, '0');
                        } else {
                            const len = t.end - t.start + 1;
                            return (t.start + (n % len)).toString().padStart(t.pad, '0');
                        }
                    });

                    let idx = 0;
                    const url = m3u8Text.replace(rangePattern, () => values[idx++]);

                    if (generatedSet.has(url)) break;
                    generatedSet.add(url);

                    // 探查模式需要fetch验证
                    if (hasOpen) {
                        try {
                            const response = await fetch(url, { method: 'HEAD' });
                            if (!response.ok) break;
                        } catch {
                            break;
                        }
                    }

                    urls.push(url);
                    n++;
                }

                if (urls.length) {
                    m3u8Text = urls.join("\n\n");
                    $("#m3u8Text").val(m3u8Text);
                } else {
                    $("#m3u8Text").val("");
                    alert(i18n.m3u8Error);
                    return;
                }
            }

            // 只有一个链接 后缀为m3u8 直接解析
            const urlExt = GetExt(m3u8Text);
            if (m3u8Text.split("\n").length == 1 && (urlExt == "m3u8" || urlExt == "m3u" || urlExt == "txt")) {
                let url = "m3u8.html?url=" + encodeURIComponent(m3u8Text);
                if (referer) {
                    if (referer.startsWith("http")) {
                        url += "&requestHeaders=" + encodeURIComponent(JSON.stringify({ referer: referer }));
                    } else {
                        url += "&requestHeaders=" + encodeURIComponent(referer);
                    }
                }
                chrome.tabs.update({ url: url });
                return;
            }

            // 如果不是 m3u8 文件内容 转换为 m3u8 文件内容
            if (!m3u8Text.includes("#EXTM3U")) {
                // ts列表链接 转 m3u8
                const tsList = m3u8Text.split("\n");
                m3u8Text = "#EXTM3U\n";
                m3u8Text += "#EXT-X-TARGETDURATION:233\n";
                for (let ts of tsList) {
                    if (ts) {
                        m3u8Text += "#EXTINF:15\n";
                        m3u8Text += ts + "\n";
                    }
                }
                m3u8Text += "#EXT-X-ENDLIST";
            }
            if (baseUrl != "") {
                m3u8Text = addBashUrl(baseUrl, m3u8Text);
            }
            autoReferer = true; // 不自动调整referer

            _m3u8Url = URL.createObjectURL(new Blob([new TextEncoder("utf-8").encode(m3u8Text)]));
            hls.loadSource(_m3u8Url);
            $("#m3u8Custom").hide();
        });

        // 从mpd解析器读取数据
        if (_getMpdId) {
            chrome.tabs.sendMessage(_getMpdId, "getM3u8", function (result) {
                $("#m3u8Text").val(result.m3u8Content);
                $("#parse").click();
                $("#info").html(result.mediaInfo);
            });
        }
    } else {
        /*
        * firefox 不允许直接下载跨域blob内容 由content-script获取blob内容发回页面
        */
        if (_m3u8Url.startsWith("blob:") && G.isFirefox) {
            chrome.tabs.sendMessage(tabId, { Message: "getM3u8Text", url: _m3u8Url }, function (result) {
                const blobUrl = URL.createObjectURL(new Blob([new TextEncoder("utf-8").encode(result)]));
                hls.loadSource(blobUrl);
            });
        } else {
            hls.loadSource(_m3u8Url);
        }
    }
}

// 监听 MANIFEST_LOADED 装载解析的m3u8 URL
hls.on(Hls.Events.MANIFEST_LOADED, function (event, data) {
    $("#m3u8_url").attr("href", data.url).html(data.url);
});


// 监听 MANIFEST_PARSED m3u8解析完成
hls.on(Hls.Events.MANIFEST_PARSED, function (event, data) {
    // console.log(data);
    $("#m3u8").show(); $("#loading").hide();
    const more = (data.levels.length + data.audioTracks.length + data.subtitleTracks.length >= 2);
    const dataMerge = {};

    // 多个视频
    if (more && data.levels.length) {
        $("#more_m3u8").show();
        let maxBandwidth = 0;
        for (let index in data.levels) {
            const item = data.levels[index];
            let [name, url] = getNewUrl(item);
            maxBandwidth = Math.max(maxBandwidth, item.attrs.BANDWIDTH);
            if (maxBandwidth == item.attrs.BANDWIDTH) { dataMerge.video = item; }   // 默选择码率最大的
            const html = $(`<div class="block">
                    <div><label class="more_class"><input type="radio" name="more_video" ${maxBandwidth == item.attrs.BANDWIDTH ? "checked" : ""}/>${item.attrs.RESOLUTION ? i18n.resolution + ":" + item.attrs.RESOLUTION : ""}${item.attrs.BANDWIDTH ? " | " + i18n.bitrate + ":" + (parseInt(item.attrs.BANDWIDTH / 1000) + " Kbps") : ""}</label></div>
                    <a href="${url}">${name}</a>
                    <button id="parser" type="button">${i18n.parser}</button>
                </div>`);
            html.find("#parser").click(function () {
                chrome.tabs.update({ url: url });
            });
            html.find(".more_class").click(function (e) {
                dataMerge.video = item;
            });
            $("#next_m3u8").append(html);
        }
    }
    // 多个音频
    if (more && data.audioTracks.length) {
        $("#more_audio").show();
        for (let index in data.audioTracks) {
            const item = data.audioTracks[index];
            // 音频信息没有m3u8文件 使用groupId去寻找
            if (item.url == "") {
                let groupId = item.groupId;
                for (let item2 of data.levels) {
                    if (item2.audioGroupIds.includes(groupId)) {
                        item.url = item2.uri;
                        break;
                    }
                }
            }
            let [name, url] = getNewUrl(item);
            if (index == 0) { dataMerge.audio = item; }     // 默选择第一个
            const html = $(`<div class="block">
                    <div><label><input type="radio" name="more_audio" ${index == 0 ? "checked" : ""}/>${item.name ? item.name : ""} | ${item.lang ? item.lang : ""} | ${item.groupId ? item.groupId : ""}</label></div>
                    <a href="${url}">${name}</a>
                    <button id="parser" type="button">${i18n.parser}</button>
                </div>`);
            html.find("#parser").click(function () {
                chrome.tabs.update({ url: url });
            });
            html.find("label").click(function () {
                dataMerge.video = item;
            });
            $("#next_audio").append(html);
        }
    }
    // 多个字幕
    if (more && data.subtitleTracks.length) {
        $("#more_subtitle").show();
        for (let item of data.subtitleTracks) {
            const [name, url] = getNewUrl(item);
            const html = `<div class="block">
                    <div>${item.name ? item.name : ""} | ${item.lang ? item.lang : ""}</div>
                    <a href="${url}">${name}</a>
                </div>`;
            $("#next_subtitle").append(html);
        }
    }

    // 合并按钮
    if (dataMerge.audio && dataMerge.video) {
        $("#more_options").show();
        $("#more_options_merge").click(function () {
            const taskId = Date.parse(new Date());
            if (dataMerge.audio && dataMerge.video) {
                const data = {
                    title: _title,
                    downFileName: _fileName,
                    tabId: tabId,
                    initiator: _initiator,
                    requestHeaders: requestHeaders,
                }
                const options = { ffmpeg: "merge", quantity: 2, taskId: taskId, autoDown: true, autoClose: true };
                openParser({ ...data, url: dataMerge.audio.url }, { ...options, isMaster: true });
                openParser({ ...data, url: dataMerge.video.url }, { ...options, isMaster: false });
            }
        });
    } else {
        $("#more_m3u8 input").hide();
        $("#more_audio input").hide();
    }


    // 有下一级m3u8 停止解析
    if (more) {
        autoDown && highlight();
        $("#m3u8").hide();
        // $("button").hide();
        return;
    }

    /**
     * 跳转到新m3u8解析器
     * @param {Object} item m3u8 url对象
     * @returns 文件名和新链接 字符串数组
     */
    function getNewUrl(item) {
        const rawUrl = item.uri ?? item.url;
        const name = GetFile(rawUrl);
        const params = new URLSearchParams(window.location.search);
        params.set('url', rawUrl);
        params.delete('autoDown');
        params.delete('ffmpeg');
        const newUrl = `/m3u8.html?${params.toString()}`;
        return [name, newUrl];
    }
});

// 监听 LEVEL_LOADED 所有切片载入完成
hls.on(Hls.Events.LEVEL_LOADED, function (event, data) {
    // console.log(data);
    parseTs(data.details);  // 提取Ts链接
    // 获取视频信息
    if ($(".videoInfo #info").html() == "") {
        let video = document.createElement("video");
        video.muted = true;
        video.autoplay = false;
        hls.attachMedia(video);
        hls.on(Hls.Events.MEDIA_ATTACHED, function () {
            video && video.play();
        });
        video.oncanplay = function () {
            hls.detachMedia(video);
            video.remove();
            video = null;
        }
        video.onerror = function () {
            hls.stopLoad();
            hls.detachMedia(video);
            video.remove();
            video = null;
        }
    }
    currentLevel = data.level;

    //自定义文件名 下拉选项
    const $options = $("#name-options");
    // 标题
    if (_title) {
        let title = _title;
        if (title.length >= 150) {
            title = title.substring(title.length - 150);
        }
        $options.append(`<option value="${title}">${title}</option>`);
    }

    // 文件名
    if (_fileName) {
        let fileName = _fileName;
        if (fileName.length >= 150) {
            fileName = fileName.substring(fileName.length - 150);
        }
        $options.append(`<option value="${fileName}">${fileName}</option>`);
    }

    // m3u8链接最后一部分
    if (_m3u8Url) {
        let fileName = GetFileNameNoExt(_m3u8Url);
        if (fileName != "NULL" && fileName.length != 0) {
            $options.append(`<option value="${stringModify(fileName)}">${stringModify(fileName)}</option>`);
        }
    }

    // 第一个ts链接文件名
    let mapFileName = GetFileNameNoExt(_fragments[0].initSegment?.url ?? _fragments[0].url);
    if (mapFileName != "NULL" && mapFileName.length != 0) {
        $options.append(`<option value="${stringModify(mapFileName)}">${stringModify(mapFileName)}</option>`);
    }
});

// 监听 ERROR m3u8解析错误
hls.on(Hls.Events.ERROR, function (event, data) {

    /**
     * 如果m3u8清单获取错误 尝试从缓存获取 解决部分网站一次性url问题
     * 仅限于第一次加载m3u8文件时发生错误(使用hls.levels.length判断) 其他情况不处理
     */
    if (data.type == 'networkError' &&
        data.details == "manifestLoadError" &&
        data.url.startsWith("http") &&
        data.response &&
        // (data.response.code === 403 || data.response.code === 404) &&
        tabId &&
        tabId != -1 &&
        !hls.levels.length) {
        chrome.tabs.sendMessage(tabId, {
            Message: "getM3u8Cache",
            url: data.url
        }, (response) => {
            if (!response || !response.success || !response.data) { return; }
            const baseUrl = data.url.substring(0, data.url.lastIndexOf("/") + 1);
            const m3u8Text = addBashUrl(baseUrl, response.data);
            const blobUrl = URL.createObjectURL(new Blob([new TextEncoder("utf-8").encode(m3u8Text)]));

            hls.stopLoad();
            hls.loadSource(blobUrl);
        });
    }

    autoDown && highlight();
    console.log(data);
    if (data.details == "bufferStalledError") {
        hls.stopLoad();
    }
    if (data.type == "mediaError" && data.details == "fragParsingError") {
        if (data.error.message == "No ADTS header found in AAC PES" && !hls.adtsTips) {
            $("#tips").append("<b>" + i18n.ADTSerror + "</b>");
            hls.stopLoad();
            hls.destroy();
            hls.adtsTips = true; // 标记已经提示过
        }
        return;
    }
    if (data.type == "otherError" && data.error.message.includes("remux") && hls.skipTheError) {
        return;
    }
    $("#loading").show();
    $("#loading .optionBox").html(i18n.m3u8Error);

    /**
     * 下载出错 如果在录制中 停止下载 保存文件
     * 检查重试次数 重新下载
     */
    if (retryCount) {
        recorder && stopRecorder();
        const recorderRetryCount = retryCount;
        const url = new URL(location.href);
        const params = new URLSearchParams(url.search);
        params.set("retryCount", recorderRetryCount ? recorderRetryCount - 1 : 0);
        params.set("autoDown", 1);
        $progress.html(i18n.retryCount + ": " + recorderRetryCount);
        setTimeout(() => {
            window.location.href = window.location.origin + window.location.pathname + "?" + params.toString();
        }, 3000);
        return;
    }
    if (recorder) {
        stopRecorder();
        autoReferer = true;
        return;
    }

    // 尝试添加 / 删除请求头
    if (data.type == "networkError" && data.details != "keyLoadError") {
        if (requestHeaders.referer) {
            params.delete("requestHeaders");
        } else if (_initiator) {
            params.delete("requestHeaders");
            let origin = null;
            try { origin = new URL(_initiator).origin; } catch (e) { }
            params.append("requestHeaders", JSON.stringify({ "referer": _initiator, "origin": origin ?? _initiator }));
        }
        const href = window.location.origin + window.location.pathname + "?" + params.toString();
        if (!autoReferer && window.location.href != href) {
            window.location.href = href + "&autoReferer=1";
        }
    }
});

// 监听 BUFFER_CREATED 获得第一个切片数据
hls.on(Hls.Events.BUFFER_CREATED, function (event, data) {
    // console.log(data);
    const info = $(".videoInfo #info");
    if (data.tracks && info.html() == "") {
        if (data.tracks.audiovideo) {
            if (data.tracks.audiovideo?.metadata) {
                info.append(` ${i18n.resolution}:${data.tracks.audiovideo.metadata.width} x ${data.tracks.audiovideo.metadata.height}`);
            }
            if (data.tracks.audiovideo.codec && data.tracks.audiovideo.codec.startsWith("hvc1")) {
                info.append(` <b>${i18n.hevcTip}</b>`);
            }
            return;
        }
        !data.tracks.audio && info.append(` (${i18n.noAudio})`);
        !data.tracks.video && info.append(` (${i18n.noVideo})`);
        if (data.tracks.video?.metadata) {
            info.append(` ${i18n.resolution}:${data.tracks.video.metadata.width} x ${data.tracks.video.metadata.height}`);
        }
        if (hls.levels[currentLevel]?.bitrate) {
            info.append(` ${i18n.bitrate}:${parseInt(hls.levels[currentLevel].bitrate / 1000)} Kbps`);
        }
        if (data.tracks?.video?.codec && data.tracks.video.codec.startsWith("hvc1")) {
            info.append(` <b>${i18n.hevcTip}</b>`);
        }
    }
});

/* 来自 监听 LEVEL_LOADED 提取所有ts链接 进一步处理 */
function parseTs(data) {
    // console.log(data);
    let isEncrypted = false;
    _fragments.splice(0);   // 清空 防止直播HLS无限添加

    for (let i in data.fragments) {
        i = parseInt(i);
        /*
        * 少部分网站下载ts必须带有参数才能正常下载
        * 添加m3u8地址的参数
        */
        if (tsAddArg != null) {
            const arg = new RegExp("([^?]*)").exec(data.fragments[i].url);
            if (arg && arg[0]) {
                data.fragments[i].url = arg[0] + (tsAddArg ? "?" + tsAddArg : "");
            }
        }
        /* 
        * 查看是否加密 下载key
        * firefox CSP政策不允许在script-src 使用blob 不能直接调用hls.js下载好的密钥
        */
        if (data.fragments[i].encrypted && data.fragments[i].decryptdata) {
            isEncrypted = true;
            // 填入key内容
            Object.defineProperty(data.fragments[i].decryptdata, "keyContent", {
                get: function () { return keyContent.get(this.uri); },
                configurable: true
            });
            // 如果不存在key 开始下载
            if (!keyContent.get(data.fragments[i].decryptdata.uri)) {
                // 占位 等待fetch获取key
                keyContent.set(data.fragments[i].decryptdata.uri, true);
                // 下载key
                fetch(data.fragments[i].decryptdata.uri)
                    .then(response => response.arrayBuffer())
                    .then(function (buffer) {
                        if (buffer.byteLength == 16) {
                            keyContent.set(data.fragments[i].decryptdata.uri, buffer); // 储存密钥
                            showKeyInfo(buffer, data.fragments[i].decryptdata, i);
                            autoMerge();
                            return;
                        }
                        showKeyInfo(false, data.fragments[i].decryptdata, i);
                    })
                    .catch(function (error) {
                        console.log(error);
                        showKeyInfo(false, data.fragments[i].decryptdata, i);
                    });
            }
        }
        // 处理 #EXT-X-MAP 标签
        let initSegment = null;
        if (data.fragments[i].initSegment && !initData.get(data.fragments[i].initSegment.url)) {
            initSegment = data.fragments[i].initSegment;
            initData.set(data.fragments[i].initSegment.url, true);

            const options = {};
            if (data.fragments[i].initSegment.byteRange && data.fragments[i].initSegment.byteRange.length == 2) {
                const [start, end] = data.fragments[i].initSegment.byteRange;
                options.headers = {
                    'Range': `bytes=${start}-${end - 1}`
                };
            }
            fetch(data.fragments[i].initSegment.url, options)
                .then(response => response.arrayBuffer())
                .then(function (buffer) {
                    initData.set(data.fragments[i].initSegment.url, buffer);
                    autoMerge();
                }).catch(function (error) { console.log(error); });
            $("#tips").append('EXT-X-MAP: <input type="text" class="keyUrl" value="' + data.fragments[i].initSegment.url + '" spellcheck="false" readonly="readonly">');
        }

        if (data.live && data.fragments[i].initSegment) {
            initSegment = data.fragments[i].initSegment;
        }

        _fragments.push({
            url: data.fragments[i].url,
            decryptdata: data.fragments[i].decryptdata,
            encrypted: data.fragments[i].encrypted,
            duration: data.fragments[i].duration,
            initSegment: initSegment,
            sn: data.fragments[i].sn,
            cc: data.fragments[i].cc,
            live: data.live,
            byteRange: data.fragments[i].byteRange,
        });
    }

    /* 
    * 录制直播
    * 直播是持续更新的m3u8 
    * recorderLast保存下载的最后一个sn 以便下次更新时判断从哪个切片开始继续下载
    */
    if (recorder) {
        let indexLast = _fragments.findIndex((fragment) => {
            return fragment.sn == recorderLast;
        });
        recorderLast = _fragments[_fragments.length - 1].sn;
        downloadNew(indexLast + 1);
    }


    // 提示加密
    isEncrypted && $("#count").append(` (${i18n.encryptedHLS})`);

    // SAMPLE 加密算法
    if (data.m3u8.includes("#EXT-X-KEY:METHOD=SAMPLE-AES-CTR")) {
        $("#count").append(' <b>' + i18n.encryptedSAMPLE + '</b>');
    }

    if (data.live) {
        autoDown && highlight();
        $("#recorder").show();
        $(".videoInfo #info").html(i18n.liveHLS);
    } else {
        estimateFileInfo(_fragments, data.totalduration); // 估算文件大小
        $("#count").append(i18n("m3u8Info", [_fragments.length, secToTime(data.totalduration)]));
    }
    if (!_fragments.some(fragment => fragment.initSegment) && autoDown) {
        autoMerge();
    }

    /**
     * 是否需要数据预处理。
     * 判断是否非常见切片格式。否则勾选预处理。
     */
    if (!["ts", "mp4", "m4s", "aac", "ac3", "webm"].includes(GetExt(_fragments[0].url))) {
        opt.dataPreprocessing = true;
    }


    function showKeyInfo(buffer, decryptdata, i) {
        const $tips = $("#tips");
        $tips.append(`${i18n.keyAddress}: <input type="text" value="${decryptdata.uri}" spellcheck="false" readonly="readonly" class="keyUrl">`);
        // 准备算法及密钥字段
        const method = decryptdata.method || "NONE";
        const keyHex = buffer ? ArrayBufferToHexString(buffer) : i18n.keyDownloadFailed;
        const keyBase64 = buffer ? ArrayBufferToBase64(buffer) : null; // buffer 为空时不显示 Base64
        // 构建 key 区块（包含算法、Hex、可能的 Base64）
        let keyBlock = `
        <div class="method">${i18n.encryptionAlgorithm}: <input type="text" value="${method}" spellcheck="false" readonly="readonly"></div>
        <div>${i18n.key}(Hex): <input type="text" value="${keyHex}" spellcheck="false" readonly="readonly"></div>`;
        if (keyBase64 !== null) {
            keyBlock += `<div>${i18n.key}(Base64): <input type="text" value="${keyBase64}" spellcheck="false" readonly="readonly"></div>`;
        }
        // 检查 IV 是否为默认值（常见 MPEG-DASH 的默认 IV：末尾为 i 或 i+1）
        const defaultIv1 = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, i + 1]).toString();
        const defaultIv2 = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, i]).toString();
        const currentIv = decryptdata.iv.toString();
        if (currentIv !== defaultIv1 && currentIv !== defaultIv2) {
            const ivHex = "0x" + ArrayBufferToHexString(decryptdata.iv.buffer);
            keyBlock += `<div>Offset(IV): <input type="text" value="${ivHex}" spellcheck="false" readonly="readonly" class="offset"></div>`;
        }
        // 整体放入同一个 flex 容器
        $tips.append(`<div class="key flex">${keyBlock}</div>`);
    }
}
/**
 * 估算整个视频大小
 * 获取几个切片大小 取平均值 * 切片数量
 * @param {Array} url ts对象数组
 * @param {number} duration 视频总时长
 */
async function estimateFileInfo(fragments, duration) {
    if (!fragments || fragments.length === 0) return;

    const samplesToCheck = Math.min(10, fragments.length);
    let totalSize = 0;
    let successfulFetches = 0;

    const promises = [];

    for (let i = 0; i < samplesToCheck; i++) {
        promises.push(
            fetch(fragments[i].url, {
                method: "HEAD",
                headers: requestHeaders,
            }).then(function (response) {
                if (response.ok) {
                    const contentLength = response.headers.get("Content-Length");
                    if (contentLength) {
                        totalSize += parseInt(contentLength);
                        successfulFetches++;
                    }
                }
            }).catch(function (error) {
                console.log(`Error estimating file size for sample ${i}:`, error);
            })
        );
    }

    await Promise.all(promises);

    if (successfulFetches > 0) {
        estimateFileSize = totalSize / successfulFetches * fragments.length;
        $("#estimateFileSize").append(` ${i18n.estimateSize}: ${byteToSize(estimateFileSize)}`);
        const bitrate = (estimateFileSize * 8) / duration;
        $("#estimateBitrate").append(` ${i18n.bitrate}: ${formatBitrate(bitrate)}`);
    }
}
/**************************** 监听 / 按钮绑定 ****************************/
// 标题
let progressTimer = setInterval(() => {
    if ($progress.html()) {
        document.title = $progress.html();
    }
}, 1000);
// 监听下载事件 修改提示
chrome.downloads.onChanged.addListener(function (downloadDelta) {
    if (!downloadDelta.state) { return; }
    if (downloadDelta.state.current == "complete" && downId == downloadDelta.id) {
        $progress.html(i18n.SavePrompt);
        opt.autoClose && closeTab();
    }
});
// 打开目录
$(".openDir").click(function () {
    downId ? chrome.downloads.show(downId) : chrome.downloads.showDefaultFolder();
});
function stopRecorder() {
    $("#recorder").html(i18n.recordLive).data("switch", "on");
    recorder = false;
    fileStream.close();
    buttonState("#mergeTs", true);
    $progress.html(i18n.stopRecording);
    initDownload();
}
// 录制直播
$("#recorder").click(function () {
    if ($(this).data("switch") == "on") {
        initDownload(); // 初始化下载变量
        recorder = true;

        // 只允许流式下载
        opt.StreamSaver = true;
        opt.ffmpeg = false;
        fileStream = createStreamSaver(_fragments[0].url);

        $(this).html(fileStream ? i18n.stopDownload : i18n.download).data("switch", "off");
        $progress.html(i18n.waitingForLiveData);
        return;
    }
    stopRecorder();
});
// 在线下载合并ts
$("#mergeTs").click(function () {
    initDownload(); // 初始化下载变量

    // 大文件无法使用在线ffmpeg 会回退输出ts 改用内置mp4转码
    if (!G.isFirefox && opt.ffmpeg && !_ffmpeg && estimateFileSize > G.chromeLimitSize) {
        opt.ffmpeg = false;
        opt.mp4 = true;
        downSet.mp4 = true;
    }
    // 估算检查文件大小
    if (!opt.StreamSaver && estimateFileSize > G.chromeLimitSize && confirm(i18n("fileTooLargeStream", ["2G"]))) {
        opt.StreamSaver = true;
    }

    // 流式下载
    if (opt.StreamSaver) {
        fileStream = createStreamSaver(_fragments[0].url);
        downloadNew();
        opt.ffmpeg = false;
        opt.saveAs = false;
        $("#stopDownload").show();
        return;
    }
    $("#stopDownload").show();
    downloadNew();
});

/**
 * 调用新下载器的方法
 * @param {number} start 下载范围 开始索引
 * @param {number} end 下载范围 结束索引
 */
function downloadNew(start = 0, end = _fragments.length) {

    // 避免重复下载
    buttonState("#mergeTs", false);

    // 切片下载器
    const down = new Downloader(recorder ? _fragments.slice(start) : _fragments);
    down.autoRetry = true;  // 开启自动重试
    $progress.html(`${down.success}/${down.total}`);

    // 数据预处理 切片数据伪装PNG 剔除PNG数据
    opt.dataPreprocessing && down.use(function (buffer, fragment) {
        const view = new Uint8Array(buffer);
        const len = view.length;
        let tsStartIndex = -1;

        if (len < 8) { return buffer; }

        // 检测PNG
        if (view[0] === 0x89 && view[1] === 0x50 && view[2] === 0x4E && view[3] === 0x47) {
            // 找到PNG结束标志IEND
            for (let i = 0; i < len - 4; i++) {
                if (view[i] === 73 && view[i + 1] === 69 &&
                    view[i + 2] === 78 && view[i + 3] === 68) {
                    // IEND(4字节) + CRC(4字节) = 8字节
                    tsStartIndex = i + 8;
                    break;
                }
            }
        }
        // 检测JPG
        else if (view[0] === 0xFF && view[1] === 0xD8 && view[2] === 0xFF) {
            // 找到JPG结束标志FFD9
            for (let i = 0; i < len - 2; i++) {
                if (view[i] === 0xFF && view[i + 1] === 0xD9) {
                    tsStartIndex = i + 2;
                    break;
                }
            }
        }
        // 未找到头 或者 找不到结束标志 则返回原buffer
        if (tsStartIndex === -1 || tsStartIndex >= len) {
            return buffer;
        }
        // 返回切除图片头部后的buffer
        return buffer.slice(tsStartIndex);
    }, 'preprocess');

    // 解密函数
    down.use(function (buffer, fragment) {
        return new Promise(function (resolve, reject) {
            // 跳过解密 录制模式 切片不存在加密 跳过解密 直接返回
            if (recorder || !fragment.encrypted || !fragment.decryptdata) {
                /**
                 * (!fragment.live || fragment.index == 0)
                 * 如果是直接下载直播流 只有第一个切片才会添加MAP 否则每个切片都添加MAP视频无法播放。
                 */
                if (fragment.initSegment && (!fragment.live || fragment.index == 0)) {
                    buffer = addInitSegmentData(buffer, fragment.initSegment);
                }
                resolve(buffer);
                return;
            }
            // 载入密钥 开始解密
            try {
                decryptor.expandKey(fragment.decryptdata.keyContent);
                const iv = fragment.decryptdata.iv ?? new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, fragment.sn]);
                buffer = decryptor.decrypt(buffer, 0, iv.buffer, true);
            } catch (e) {
                $progress.html(i18n.decryptionError + e);
                down.stop();
                buttonState("#mergeTs", true);
                console.log(e);
                reject(e);
                return;
            }
            // 如果存在MAP切片 把MAP整合进buffer
            // MAP切片不需要解密
            if (fragment.initSegment) {
                buffer = addInitSegmentData(buffer, fragment.initSegment);
            }
            resolve(buffer);
        });
    }, 'decrypt');
    // 转码函数 如果存在down.mapTag 跳过转码
    if (downSet.mp4 && !down.mapTag) {
        let tempBuffer = null;
        let head = true;
        transmuxer = new muxjs.mp4.Transmuxer({ keepOriginalTimestamps: false, remux: true });    // mux.js 对象
        transmuxer.on('data', function (segment) {
            if (head) {
                let data = new Uint8Array(segment.initSegment.byteLength + segment.data.byteLength);
                data.set(segment.initSegment, 0);
                data.set(segment.data, segment.initSegment.byteLength);
                tempBuffer = fixFileDuration(data, down.totalDuration);
                return;
            }
            tempBuffer = segment.data;
        });
        down.use(async function (buffer, fragment) {
            head = fragment.index == 0;
            tempBuffer = null;  // 避免转码无输出时 重复写入上一个切片的数据
            transmuxer.push(new Uint8Array(buffer));
            transmuxer.flush();
            if (!tempBuffer) {
                console.warn("mp4 transcode produced no output, fragment", fragment.index);
            }
            return tempBuffer ? tempBuffer.buffer : buffer;
        }, 'transcode');
    }
    // 下载错误
    down.on('downloadError', function (fragment, error) {
        $("#ForceDownload").show(); // 强制下载
        $("#errorDownload").show(); // 重下所有失败项
    });
    // 切片下载完成
    down.on('completed', function (buffer, fragment) {
        if (recorder) {
            $progress.html(i18n.waitingForLiveData);
            downDuration += fragment.duration;
            $fileDuration.html(i18n.recordingDuration + ":" + secToTime(downDuration));
            return;
        }

        $progress.html(`${down.success}/${down.total}`);
        $fileSize.html(i18n.downloaded + ":" + byteToSize(down.buffersize));
        $fileDuration.html(i18n.downloadedVideoLength + ":" + secToTime(down.duration));
    });
    // 全部下载完成
    down.on('allCompleted', async function (buffer) {
        if (recorder) { return; }
        $("#stopDownload").hide();
        if (fileStream) {
            fileStream.close();
            fileStream = undefined;
            $progress.html(i18n.downloadComplete);
        } else {
            mergeTsNew(down);
        }
        transmuxer?.off && transmuxer.off('data');
        transmuxer = undefined;

        $("#ForceDownload").hide(); // 强制下载
        $("#errorDownload").hide(); // 重下所有失败项

        buttonState("#mergeTs", true);
    });
    if (fileStream) {
        let moofSeq = 1;
        down.on('sequentialPush', function (buffer) {
            if (down.findPipeline('transcode')) {
                moofSeq = fixMoofSequence(buffer, moofSeq);
            }
            fileStream && fileStream.write(new Uint8Array(buffer));
        });
    }
    down.on('error', function (error) {
        console.log(error);
    });
    down.on('stop', function (fragment, error) {
        console.log(error);
    });

    // 开始下载
    down.start();

    // 强制下载
    $("#ForceDownload").off().click(function () {
        mergeTsNew(down);
    });

    // 重新下载
    $("#errorDownload").off().click(function () {
        down.errorItem.forEach(function (fragment, index) {
            setTimeout(() => {
                down.downloader(fragment);
            }, index * 233);
        });
    });

    // 停止下载
    $("#stopDownload").off().click(function () {
        down.stop();
        setTimeout(() => {
            fileStream && fileStream.close();
            $progress.html(i18n.stopDownload);
            $("#stopDownload").hide();
            buttonState("#mergeTs", true);
            $fileSize.html("");
            $fileDuration.html("");
            initDownload();
        }, 1000);
    });
}

function addInitSegmentData(buffer, initSegment) {
    let initSegmentData = initData.get(initSegment.url);
    if (!initSegmentData && initSegment.data) {
        initSegmentData = initSegment.data.buffer;
    }
    const initLength = initSegmentData.byteLength;
    const newData = new Uint8Array(initLength + buffer.byteLength);
    newData.set(new Uint8Array(initSegmentData), 0);
    newData.set(new Uint8Array(buffer), initLength);
    return newData.buffer;
}

// 合并下载
function mergeTsNew(down) {
    $progress.html(i18n.merging);

    // 按切片顺序重写 moof 序号
    if (down.findPipeline('transcode')) {
        let moofSeq = 1;
        down.buffer.forEach(buffer => { moofSeq = fixMoofSequence(buffer, moofSeq); });
    }

    // 创建Blob
    const fileBlob = new Blob(down.buffer, { type: down.findPipeline('transcode') ? "video/mp4" : "video/MP2T" });

    // 默认后缀
    let ext = (down.mapTag && !down.mapTag.startsWith("data:") ? down.mapTag : down.fragments[0].url).split("/").pop();
    ext = ext.split("?").shift();
    ext = ext.split(".").pop();
    ext = ext ? ext : "ts";
    ext = down.findPipeline('transcode') ? "mp4" : ext;

    let fileName = "";
    const customFilename = $('#customFilename').val().trim();
    if (customFilename) {
        fileName = customFilename;
    } else if (_fileName) {
        fileName = _fileName;
    } else {
        fileName = GetFileName(_m3u8Url);
    }
    // 删除目录
    // fileName = fileName.split("/");
    // fileName = fileName.length > 1 ? fileName.pop() : fileName.join("");
    // 删除后缀
    let originalExt = null;
    if (/\.[a-zA-Z0-9]{1,4}$/.test(fileName)) {
        fileName = fileName.split(".");
        originalExt = fileName.pop();
        fileName = fileName.join(".");
    }
    // 发送到ffmpeg
    if (opt.ffmpeg || _ffmpeg) {
        /**
         * 大于1.8G 不使用ffmpeg直接下载
         * chrome每个进程限制2G内存 处理2G视频可能导致超过限制。1.8G是安全值。
         * firefox 不受影响
         */
        if (!G.isFirefox && fileBlob.size > G.chromeLimitSize) {
            $progress.html(i18n("fileTooLarge", ["2G"]));
            apiDownload(fileBlob, fileName, ext);
            down.destroy();
            return;
        }
        if (customFilename && originalExt) {
            fileName += "." + originalExt;
        } else if (ext != "mp4" && ext != "mp3") {
            fileName = fileName + ".mp4";
        } else {
            fileName = fileName + "." + ext;
        }
        const action = _ffmpeg ?? "transcode";
        const data = {
            Message: "catCatchFFmpeg",
            action: action,
            files: [{ data: G.isFirefox ? fileBlob : URL.createObjectURL(fileBlob), name: `memory${new Date().getTime()}.${ext}` }],
            title: fileName,
            output: fileName,
            name: "memory" + new Date().getTime() + "." + ext,
            active: G.isMobile || !autoDown,
            tabId: currentTabId
        };
        if (_quantity) {
            data.quantity = parseInt(_quantity);
        }
        if (_taskId) {
            data.taskId = _taskId;
        }

        chrome.runtime.sendMessage(data, function (response) {
            if (!chrome.runtime?.lastError && response && response == "ok") {
                $progress.html(i18n.sendFfmpeg);
                buttonState("#mergeTs", true);
                return;
            }
            apiDownload(fileBlob, fileName, ext);
            down.destroy();
            return;
        });
    } else {
        apiDownload(fileBlob, fileName, ext);
        down.destroy();
    }
}
function apiDownload(fileBlob, fileName, ext) {
    chrome.downloads.download({
        url: URL.createObjectURL(fileBlob),
        filename: fileName + "." + ext,
        saveAs: opt.saveAs
    }, function (downloadId) {
        if (downloadId) {
            downId = downloadId;
            $(".openDir").show();
            buttonState("#mergeTs", true);
        } else if (chrome.runtime?.lastError?.message && chrome.runtime.lastError.message == 'Invalid filename') {
            apiDownload(fileBlob, stringModify(fileName), ext);
            return;
        }
    });
}

// 初始化下载变量
function initDownload() {
    $fileSize.html("");
    downDuration = 0;   // 初始化时长
    $fileDuration.html("");
    recorderLast = "";  // 录制最后下载的url
    fileStream = undefined; // 流式下载 文件流
    // 转码工具初始化
    transmuxer = undefined;
    // 避免下载中途 更改设置 暂时储存下载配置
    downSet.mp4 = opt.mp4;
}

// 流式下载
function createStreamSaver(url) {
    streamSaver.mitm = G.streamSaverConfig.url;
    const ext = opt.mp4 ? "mp4" : GetExt(url);
    return streamSaver.createWriteStream(`${GetFileName(url)}.${ext}`).getWriter();
}
window.addEventListener('beforeunload', function () {
    fileStream && fileStream.abort();
});
window.onbeforeunload = function (event) {
    if (fileStream) {
        event.returnValue = i18n.streamOnbeforeunload;
    }
}
// 获取文件名不带扩展名
function GetFileNameNoExt(url) {
    url = GetFile(url);
    url = url.split(".");
    if (url.length > 1) {
        url.pop();
    }
    url = url.join(".");
    if (url.length >= 150) {
        url = url.substring(url.length - 150);
    }
    if (url.length == 0) {
        url = "NULL";
    }
    return stringModify(url);
}

// 获取文件名
function GetFile(str) {
    str = str.split("?")[0];
    if (str.substr(0, 5) != "data:" && str.substr(0, 4) != "skd:") {
        return str.split("/").pop();
    }
    return str;
}
// 获得不带扩展的文件名
function GetFileName(url) {
    //hiaming 增加自定义名字功能
    if ($('#customFilename').val()) {
        return $('#customFilename').val().trim();
    }
    if (G.TitleName && _title) {
        if (_title.length >= 150) {
            return _title.substring(_title.length - 150);
        }
        return _title;
    }
    return GetFileNameNoExt(url);
}

// 获取扩展名
function GetExt(url) {
    let fileName = GetFile(url);
    let str = fileName.split(".");
    if (str.length == 1) {
        return undefined;
    }
    let ext = str[str.length - 1];
    ext = ext.match(/[0-9a-zA-Z]*/);
    return ext[0].toLowerCase();
}
// 按钮状态
function buttonState(obj = "#mergeTs", state = true) {
    if (state) {
        $(obj).prop("disabled", false).removeClass("no-drop");
        return;
    }
    $(obj).prop("disabled", true).addClass("no-drop");
}
// ArrayBuffer 转 16进制字符串
function ArrayBufferToHexString(buffer) {
    let binary = "";
    let bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += ('00' + bytes[i].toString(16)).slice(-2);
    }
    return binary;
}
// ArrayBuffer 转 Base64
function ArrayBufferToBase64(buffer) {
    let binary = "";
    let bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}
/**
 * 修正 moof 序号
 * mux.js 每个轨道各自从0计数 序号重复 QuickTime(AVFoundation) 只能读到第一个分片
 * 序号必须从1开始连续递增 所以只能在按顺序输出时处理
 * @param {ArrayBuffer} buffer 转码后的切片数据 原地修改
 * @param {number} seq 起始序号
 * @returns {number} 下一个序号
 */
function fixMoofSequence(buffer, seq) {
    const view = new DataView(buffer);
    let offset = 0;
    while (offset + 8 <= view.byteLength) {
        let size = view.getUint32(offset);
        if (size == 1 && offset + 16 <= view.byteLength) {
            size = Number(view.getBigUint64(offset + 8));
        }
        if (size < 8) { break; }
        // moof 第一个子box为 mfhd 序号位于 moof 起始偏移20
        if (view.getUint32(offset + 4) == 0x6D6F6F66 && offset + 24 <= view.byteLength && view.getUint32(offset + 12) == 0x6D666864) {
            view.setUint32(offset + 20, seq++);
        }
        offset += size;
    }
    return seq;
}
/* 修正mp4文件显示时长 */
function fixFileDuration(data, duration) {
    // duration = parseInt(duration);
    let mvhdBoxDuration = duration * 90000;
    function getBoxDuration(data, duration, index) {
        let boxDuration = "";
        index += 16;    // 偏移量 16 为timescale
        boxDuration += data[index].toString(16);
        boxDuration += data[++index].toString(16);
        boxDuration += data[++index].toString(16);
        boxDuration += data[++index].toString(16);
        boxDuration = parseInt(boxDuration, 16);
        boxDuration *= duration;
        return boxDuration;
    }
    for (let i = 0; i < data.length; i++) {
        // mvhd
        if (data[i] == 0x6D && data[i + 1] == 0x76 && data[i + 2] == 0x68 && data[i + 3] == 0x64) {
            mvhdBoxDuration = getBoxDuration(data, duration, i);   // 获得 timescale
            data[i + 11] = 0;   //删除创建日期
            i += 20;    // mvhd 偏移20 为duration
            data[i] = (mvhdBoxDuration & 0xFF000000) >> 24;
            data[++i] = (mvhdBoxDuration & 0xFF0000) >> 16;
            data[++i] = (mvhdBoxDuration & 0xFF00) >> 8;
            data[++i] = mvhdBoxDuration & 0xFF;
            continue;
        }
        // tkhd
        if (data[i] == 0x74 && data[i + 1] == 0x6B && data[i + 2] == 0x68 && data[i + 3] == 0x64) {
            i += 24;    // tkhd 偏移24 为duration
            data[i] = (mvhdBoxDuration & 0xFF000000) >> 24;
            data[++i] = (mvhdBoxDuration & 0xFF0000) >> 16;
            data[++i] = (mvhdBoxDuration & 0xFF00) >> 8;
            data[++i] = mvhdBoxDuration & 0xFF;
            continue;
        }
        // mdhd
        // 分片mp4的 mdhd 只描述 moov 内的样本(为空) 必须为0
        // 写入总时长会让 QuickTime(AVFoundation) 把分片接在这段时长之后 时长翻倍且画面错位
        if (data[i] == 0x6D && data[i + 1] == 0x64 && data[i + 2] == 0x68 && data[i + 3] == 0x64) {
            const mdhdBoxDuration = 0;
            i += 20;    // mdhd 偏移20 为duration
            data[i] = (mdhdBoxDuration & 0xFF000000) >> 24;
            data[++i] = (mdhdBoxDuration & 0xFF0000) >> 16;
            data[++i] = (mdhdBoxDuration & 0xFF00) >> 8;
            data[++i] = mdhdBoxDuration & 0xFF;
            continue;
        }
        //  mdat 之后是媒体数据 结束头部修改
        if (data[i] == 0x6D && data[i + 1] == 0x64 && data[i + 2] == 0x61 && data[i + 3] == 0x74) {
            return data;
        }
    }
    return data;
}
// m3u8文件内容加入bashUrl
function addBashUrl(baseUrl, m3u8Text) {
    let m3u8_split = m3u8Text.split("\n");
    m3u8Text = "";
    for (let key in m3u8_split) {
        if (isEmpty(m3u8_split[key])) { continue; }
        if (m3u8_split[key].includes("URI=")) {
            let KeyURL = /URI="(.*)"/.exec(m3u8_split[key]);
            if (KeyURL && KeyURL[1] && !/^[\w]+:.+/i.test(KeyURL[1])) {
                m3u8_split[key] = m3u8_split[key].replace(/URI="(.*)"/, 'URI="' + baseUrl + KeyURL[1] + '"');
            }
        }
        if (!m3u8_split[key].includes("#") && !/^[\w]+:.+/i.test(m3u8_split[key])) {
            m3u8_split[key] = baseUrl + m3u8_split[key];
        }
        m3u8Text += m3u8_split[key] + "\n";
    }
    return m3u8Text;
}

function highlight() {
    autoDown = false;
    chrome.tabs.getCurrent(function name(params) {
        chrome.tabs.highlight({ tabs: params.index });
    });
}

function autoMerge() {
    if (!autoDown) { return; }
    clearTimeout(autoMergeTimer);
    autoMergeTimer = setTimeout(() => {
        autoDown = false;   // 避免重复调用
        $("#mergeTs").click();
    }, 1000);
}

// 接收 catCatchFFmpegResult
chrome.runtime.onMessage.addListener(function (Message, sender, sendResponse) {
    if (!Message.Message || Message.Message != "catCatchFFmpegResult" || Message.state != "done" || currentTabId == 0 || Message.tabId != currentTabId) { return; }
    setTimeout(() => {
        $progress.html(i18n.downloadComplete);
        opt.autoClose && closeTab();
    }, 1000);
});