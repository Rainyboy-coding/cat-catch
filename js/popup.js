// 解析参数
const params = new URL(location.href).searchParams;
const _tabId = parseInt(params.get("tabId"));

// 当前页面
const $mediaList = $('#mediaList');
const $current = $("<div></div>");
let currentCount = 0;
// 提示 操作按钮 DOM
const $tips = $("#Tips");
const $down = $("#down");
const $mergeDown = $("#mergeDown");
const $noDataTip = $("#noDataTip");
// 储存所有资源数据
const allData = new Map();
// 储存下载id
const downData = [];
// 图标地址
const favicon = new Map();
// 当前页面DOM
let pageDOM = undefined;
// HeartBeat
chrome.runtime.sendMessage(chrome.runtime.id, { Message: "HeartBeat" });
// 清理冗余数据
chrome.runtime.sendMessage(chrome.runtime.id, { Message: "clearRedundant" });
// 监听下载 出现服务器拒绝错误 调用下载器
chrome.downloads.onChanged.addListener(function (item) {
  if (G.catDownload) { delete downData[item.id]; return; }
  const errorList = ["SERVER_BAD_CONTENT", "SERVER_UNAUTHORIZED", "SERVER_FORBIDDEN", "SERVER_UNREACHABLE", "SERVER_CROSS_ORIGIN_REDIRECT", "SERVER_FAILED", "NETWORK_FAILED"];
  if (item.error && errorList.includes(item.error.current) && downData[item.id]) {
    catDownload(downData[item.id]);
    delete downData[item.id];
  }
});

// 生成资源DOM
function AddMedia(data) {
  data._title = data.title;
  data.title = stringModify(data.title);
  //文件名
  data.name = isEmpty(data.name) ? data.title + '.' + data.ext : decodeURIComponent(stringModify(data.name));
  //截取文件名长度
  let trimName = data.name;
  if (data.name && data.name.length >= 50 && !_tabId) {
    trimName = trimName.substr(0, 20) + '...' + trimName.substr(-30);
  }
  //添加下载文件名
  Object.defineProperty(data, "pageDOM", {
    get() { return pageDOM; }
  });
  data.downFileName = G.TitleName ? templates(G.downFileName, data) : data.name;
  data.downFileName = filterFileName(data.downFileName);
  if (isEmpty(data.downFileName)) {
    data.downFileName = data.name;
  }
  // 文件大小单位转换
  data._size = data.size;
  if (data.size) {
    data.size = byteToSize(data.size);
  }
  // 是否需要解析
  data.parsing = false;
  if (isM3U8(data)) {
    data.parsing = "m3u8";
  } else if (isMPD(data)) {
    data.parsing = "mpd";
  }
  // 网站图标
  if (data.favIconUrl && !favicon.has(data.webUrl)) {
    favicon.set(data.webUrl, data.favIconUrl);
  }
  data.isPlay = isPlay(data);

  if (allData.has(data.requestId)) {
    data.requestId = data.requestId + "_" + Date.now().toString();
  }

  //添加html
  data.html = $(`
        <div class="panel">
            <div class="panel-heading">
                <input type="checkbox" class="DownCheck"/>
                ${G.ShowWebIco ? `<img class="favicon ${!data.favIconUrl ? "faviconFlag" : ""}" requestId="${data.requestId}" src="${data.favIconUrl}"/>` : ""}
                <img src="img/regex.png" class="regex ${data.isRegex ? "" : "hide"}" title="${i18n.regexTitle}"/>
                <span class="group">${data.group && G.showGroup ? `[${data.group}]` : ""}</span>
                <span class="name ${data.parsing || data.isRegex || data.tabId == -1 ? "bold" : ""}">${trimName}</span>
                <span class="size ${data.size ? "" : "hide"}">${data.size}</span>
                <img src="img/parsing.png" class="icon parsing ${data.parsing ? "" : "hide"}" id="parsing" data-type="${data.parsing}" title="${i18n.parser}"/>
                <img src="img/play.png" class="icon play ${data.isPlay ? "" : "hide"}" id="play" title="${i18n.preview}"/>
                <img src="img/download.svg" class="icon download" id="download" title="${i18n.download}"/>
            </div>
            <div class="url hide">
                <div id="mediaInfo" data-state="false">
                    ${data.title ? `<b>${i18n.title}:</b> ${data.title}` : ""}
                    ${data.type ? `<br><b>MIME:</b>  ${data.type}` : ""}
                </div>
                <div class="moreButton">
                    <div id="catDown"><img src="img/cat-down.png" class="icon cat-down" title="${i18n.downloadWithRequestHeader}"/></div>
                </div>
                <a href="${data.url}" target="_blank" download="${data.downFileName}">${data.url}</a>
                <br>
                <img id="screenshots" class="hide"/>
                <video id="preview" class="hide" controls></video>
            </div>
        </div>`);
  ////////////////////////绑定事件////////////////////////
  //展开网址
  data.urlPanel = data.html.find(".url");
  data.urlPanelShow = false;
  data.panelHeading = data.html.find(".panel-heading");
  data.panelHeading.click(function (event) {
    data.urlPanelShow = !data.urlPanelShow;
    const mediaInfo = data.html.find("#mediaInfo");
    const preview = data.html.find("#preview");
    if (!data.urlPanelShow) {
      if (event.target.id == "play") {
        preview.show().trigger("play");
        return false;
      }
      data.urlPanel.hide();
      !preview[0].paused && preview.trigger("pause");
      return false;
    }
    data.urlPanel.show();
    if (!mediaInfo.data("state")) {
      mediaInfo.data("state", true);
      if (isM3U8(data)) {
        const hls = new Hls({ enableWorker: false });
        setRequestHeaders(data.requestHeaders, function () {
          hls.loadSource(data.url);
          hls.attachMedia(preview[0]);
        });
        hls.on(Hls.Events.BUFFER_CREATED, function (event, data) {
          if (data.tracks && !data.tracks.audiovideo) {
            !data.tracks.audio && mediaInfo.append(`<br><b>${i18n.noAudio}</b>`);
            !data.tracks.video && mediaInfo.append(`<br><b>${i18n.noVideo}</b>`);
          }
        });
        hls.on(Hls.Events.ERROR, function (event, data) {
          hls.stopLoad();
        });
        hls.on(Hls.Events.MANIFEST_PARSED, function (event, data) {
          if (data.levels.length > 1 && !mediaInfo.text().includes(i18n.m3u8Playlist)) {
            mediaInfo.append(`<br><b>${i18n.m3u8Playlist}</b>`);
          }
        });
        let totalFragments = 0;
        hls.on(Hls.Events.LEVEL_LOADED, function (event, data) {
          totalFragments = data.details.fragments.length;
        });
        // 通过前5个片段的下载大小和下载时间来估算码率
        const fragments = [];
        function onFragLoaded(event, data) {
          const frag = data.frag;
          const stats = frag && frag.stats;
          if (!frag || !stats || !frag.duration) return;
          const bytes = stats.total || stats.loaded || 0;
          const duration = frag.duration || 0;
          if (!bytes || !duration) return;
          fragments.push({ bytes, duration });
          if (fragments.length >= 5) {
            const totalBytes = fragments.reduce((sum, item) => sum + item.bytes, 0);
            const totalDuration = fragments.reduce((sum, item) => sum + item.duration, 0);
            const bps = totalBytes * 8 / totalDuration;
            mediaInfo.append(`<br><b>${i18n.bitrate}:</b> ${formatBitrate(bps)}`);
            totalFragments && mediaInfo.append(`<br><b>${i18n.estimateSize}:</b> ${byteToSize(totalBytes / fragments.length * totalFragments)}`);
            hls.off(Hls.Events.FRAG_LOADED, onFragLoaded);
          }
        }
        hls.on(Hls.Events.FRAG_LOADED, onFragLoaded);
      } else if (data.isPlay) {
        setRequestHeaders(data.requestHeaders, function () {
          preview.attr("src", data.url);
        });
      } else if (isPicture(data)) {
        setRequestHeaders(data.requestHeaders, function () {
          data.html.find("#screenshots").show().attr("src", data.url);
        });
        return false;
      } else {
        return false;
      }
      preview.on("loadedmetadata", function () {
        preview.show();
        if (this.duration && this.duration != Infinity) {
          data.duration = this.duration;
          mediaInfo.append(`<br><b>${i18n.duration}:</b> ${secToTime(this.duration)}`);
        }
        if (this.videoHeight && this.videoWidth) {
          mediaInfo.append(`<br><b>${i18n.resolution}:</b> ${this.videoWidth}x${this.videoHeight}`);
          data.videoWidth = this.videoWidth;
          data.videoHeight = this.videoHeight;
        }
        !isM3U8(data) && getRemoteFileSize(data.url)
          .then(function (size) {
            if (!size || isNaN(size) || size < 1024) return;
            const bps = (size * 8) / data.duration;
            mediaInfo.append(`<br><b>${i18n.bitrate}:</b> ${formatBitrate(bps)}`);
          })
          .catch(function (error) {
            console.warn(error);
          });
      });
    }
    if (event.target.id == "play") {
      preview.show().trigger("play");
    }
    return false;
  });
  // 猫抓下载器 下载
  data.html.find("#catDown").click(function () {
    catDownload(data);
  });
  // 下载
  data.html.find('#download').click(function (event) {
    if (data.parsing == "m3u8") {
      openParser(data, { autoDown: true });
      return false;
    }
    chrome.downloads.download({
      url: data.url,
      filename: data.downFileName,
      saveAs: G.saveAs
    }, function (id) { downData[id] = data; });
    return false;
  });
  //解析
  data.html.find('#parsing').click(function (e) {
    openParser(data);
    return false;
  });
  // 多选框 创建checked属性 值和checked状态绑定
  data._checked = true;
  data.html.find(".DownCheck").prop("checked", data._checked);
  data.html.find('input').click(function (event) {
    data._checked = this.checked;
    mergeDownButton();
    event.originalEvent.cancelBubble = true;
  });
  Object.defineProperty(data, "checked", {
    get() {
      return data._checked;
    },
    set(newValue) {
      data._checked = newValue;
      data.html.find('input').prop("checked", newValue);
    }
  });
  // 使用Map 储存数据
  allData.set(data.requestId, data);

  return data.html;
}

/********************绑定事件********************/
// 下载选中文件
$('#DownFile').click(function () {
  const [checkedData, maxSize] = getCheckedData();
  if (checkedData.length >= 10 && !confirm(i18n("confirmDownload", [checkedData.length]))) {
    return;
  }
  let index = 0;
  for (let data of checkedData) {
    if (data.parsing == "m3u8") {
      openParser(data, { autoDown: true, autoClose: true });
      continue;
    }
    // 以防止popup页面被关闭 丢失下载数据 批量下载前临时修改为 后台下载
    G.downActive = true;

    index++;
    setTimeout(function () {
      chrome.downloads.download({
        url: data.url,
        filename: data.downFileName
      }, function (id) { downData[id] = data; });
    }, index * 100);
  };
});
// 合并下载
$mergeDown.click(function () {
  const [checkedData, maxSize] = getCheckedData();
  const taskId = Date.parse(new Date());
  // 都是m3u8 自动合并并发送到ffmpeg
  if (checkedData.every(data => isM3U8(data))) {
    checkedData.forEach(function (data, index) {
      openParser(data, { ffmpeg: "merge", quantity: checkedData.length, taskId: taskId, autoDown: true, autoClose: true, isMaster: index === 0 });
    });
    return true;
  }
  catDownload(checkedData, { ffmpeg: "merge" })
});
// 清空数据
$('#Clear').click(function () {
  chrome.runtime.sendMessage({ Message: "clearData", tabId: G.tabId });
  chrome.runtime.sendMessage({ Message: "ClearIcon", type: true, tabId: G.tabId });
  currentCount = 0;
  $current.empty();
  allData.clear();
  UItoggle();
});
// 刷新页面
$("#reloadPage").click(function () {
  chrome.tabs.reload(G.tabId, { bypassCache: true }, function () {
    G.autoClearMode > 0 && $('#Clear').click();
  });
});
// Firefox 关闭一些功能 修复右边滚动条遮挡
if (G.isFirefox) {
  $("body").addClass("fixFirefoxRight");
  $(".firefoxHide").each(function () { $(this).hide(); });
}
async function getPageDOM() {
  try {
    const result = await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(G.tabId, { Message: "getPage" }, { frameId: 0 }, (response) => {
        if (chrome.runtime.lastError) {
          reject(null);
        } else {
          resolve(response);
        }
      });
    });

    return result ? new DOMParser().parseFromString(result, 'text/html') : null;
  } catch (error) {
    return null;
  }
}
// 一些需要等待G变量加载完整的操作
const interval = setInterval(async function () {
  if (!G.initSyncComplete || !G.initLocalComplete || !G.tabId) { return; }
  clearInterval(interval);

  // 侧边面板模式 body 宽度100%
  if (_tabId) {
    G.tabId = _tabId;
    $("body").css("width", "100%");
    $("#down").css("justify-content", "center").find("button").css("margin-left", "5px");
  }

  // 获取页面DOM
  if (G.getHtmlDOM) {
    getPageDOM().then(dom => {
      pageDOM = dom;
    }).catch(error => {
      console.error('Error getting page DOM:', error);
    });
  }
  // 填充数据
  chrome.runtime.sendMessage(chrome.runtime.id, { Message: "getData", tabId: G.tabId }, function (data) {
    if (!data || data === "OK") {
      UItoggle();
      return;
    }
    currentCount = data.length;
    if (currentCount >= 500 && confirm(i18n("confirmLoading", [currentCount]))) {
      $mediaList.append($current);
      UItoggle();
      return;
    }

    /**
     * 通过计算时间差来判断是否为同一组资源。
     * 如果时间差小于等于G.groupTime，则认为是同一组资源，并为它们分配相同的组号。
     */
    // let group = 1;
    // for (let key = 0; key < currentCount; key += 2) {
    //   const current = data[key];
    //   const next = data[key + 1];
    //   const shouldGroup = next
    //     && Math.abs(current.getTime - next.getTime) <= G.groupTime
    //     && !(current.type?.startsWith('audio') && next.type?.startsWith('audio'))
    //     && (current.ext === 'm3u8') === (next.ext === 'm3u8');
    //   if (shouldGroup) {
    //     current.group = group;
    //     next.group = group;
    //     group++;
    //   }
    //   $current[G.reverse ? "prepend" : "append"](AddMedia(current));
    //   if (next) {
    //     $current[G.reverse ? "prepend" : "append"](AddMedia(next));
    //   }
    // }

    if (G.showGroup) {
      let group = 1;
      // 判断是否是一组
      const canGroup = (a, b) => {
        if (!a || !b) return false;
        return Math.abs(a.getTime - b.getTime) <= G.groupTime
          && !(a.type?.startsWith('audio') && b.type?.startsWith('audio'))
          && (a.ext === 'm3u8') === (b.ext === 'm3u8');
      };
      let i = 0;
      while (i < currentCount) {
        const current = data[i];
        const next1 = data[i + 1];
        const next2 = data[i + 2];

        const match1 = canGroup(current, next1);
        const match2 = canGroup(next1, next2);

        if (match1) {
          const diff1 = Math.abs(current.getTime - next1.getTime);
          const diff2 = match2 ? Math.abs(next1.getTime - next2.getTime) : Infinity;

          // 【最优匹配判断】：如果 next1 和 next2 也能成组，且它们的时间差更小
          // 说明 next1 应该和 next2 结合，当前项 current 应当被跳过（单列）
          if (match2 && diff2 < diff1) {
            $current[G.reverse ? "prepend" : "append"](AddMedia(current));
            i++; // 当前项未成组，游标只前进 1 步
            continue;
          } else {
            // current 和 next1 结合是当前最佳选择
            current.group = group;
            next1.group = group;
            group++;

            $current[G.reverse ? "prepend" : "append"](AddMedia(current));
            $current[G.reverse ? "prepend" : "append"](AddMedia(next1));
            i += 2; // 两项成功分组，游标前进 2 步
            continue;
          }
        } else {
          // current 和 next1 无法成组，直接渲染 current
          $current[G.reverse ? "prepend" : "append"](AddMedia(current));
          i++; // 游标前进 1 步
        }
      }
    } else {
      data.forEach(item => {
        $current[G.reverse ? "prepend" : "append"](AddMedia(item));
      });
    }

    $mediaList.append($current);
    UItoggle();
  });
  // 监听资源数据
  chrome.runtime.onMessage.addListener(function (Message, sender, sendResponse) {
    if (!Message.Message || !Message.data) { return; }
    // 添加资源
    if (Message.Message == "popupAddData") {
      if (Message.data.tabId == G.tabId) {
        !currentCount && $mediaList.append($current);
        currentCount++;
        $current[G.reverse ? 'prepend' : 'append'](AddMedia(Message.data));
        UItoggle();
      }
      sendResponse("OK");
      return true;
    }
  });
  loadCSS();

  const observer = new MutationObserver(updateDownHeight);
  observer.observe($down[0], { childList: true, subtree: true, attributes: true });
  setTimeout(updateDownHeight, 500);
  // 是否屏蔽网站
  chrome.runtime.sendMessage(chrome.runtime.id, { Message: "damnUrlHas" }, function (response) {
    if (response && G.damn) {
      $tips.html(i18n("isBlockedSite"));
    }
  });
}, 0);
/********************绑定事件END********************/
window.addEventListener('beforeunload', function () {
  chrome.runtime.sendMessage(chrome.runtime.id, { Message: "clearRedundant" });
});

/* 格式判断 */
function isPlay(data) {
  const typeArray = ['video/ogg', 'video/mp4', 'video/webm', 'audio/ogg', 'audio/mp3', 'audio/wav', 'audio/m4a', 'video/3gp', 'video/mpeg', 'video/mov'];
  return isMediaExt(data.ext) || typeArray.includes(data.type) || isM3U8(data);
}

// 猫抓下载器
let catDownloadIsProcessing = false;
function catDownload(data, extra = {}) {
  // 防止连续多次提交
  if (catDownloadIsProcessing) {
    setTimeout(() => {
      catDownload(data, extra);
    }, 233);
    return;
  }
  catDownloadIsProcessing = true;
  if (!Array.isArray(data)) { data = [data]; }

  // 储存数据到临时变量 提高检索速度
  localStorage.setItem('downloadData', JSON.stringify(data));

  // 如果大于2G 询问是否使用流式下载
  if (!extra.ffmpeg && !G.downStream && Math.max(...data.map(item => item._size)) > G.chromeLimitSize && confirm(i18n("fileTooLargeStream", ["2G"]))) {
    extra.downStream = 1;
  }
  // 发送消息给下载器
  chrome.runtime.sendMessage(chrome.runtime.id, { Message: "catDownload", data: data }, (message) => {
    // 不存在下载器或者下载器出错 新建一个下载器
    if (chrome.runtime.lastError || !message || message.message != "OK") {
      createCatDownload(data, extra);
      return;
    }
    catDownloadIsProcessing = false;
  });
}
function createCatDownload(data, extra) {
  chrome.tabs.get(G.tabId, function (tab) {
    const arg = {
      url: `/downloader.html?${new URLSearchParams({
        requestId: data.map(item => item.requestId).join(","),
        ...extra
      })}`,
      index: tab.index + 1,
      active: !G.downActive
    };
    chrome.tabs.create(arg, (tab) => {
      // 循环获取tab.id 的状态 准备就绪 重置任务状态
      const interval = setInterval(() => {
        chrome.tabs.get(tab.id, (tab) => {
          if (chrome.runtime.lastError || tab.status == "complete") {
            clearInterval(interval);
            catDownloadIsProcessing = false;
          }
        });
      });
    });
  });
}

// 提示
function Tips(text, delay = 200) {
  // 获取当前提示元素
  const $tips = $('#TipsFixed');

  // 停止当前所有动画
  $tips.stop(true, true);

  // 设置新内容并显示
  $tips
    .html(text)
    .fadeIn(500)
    .delay(delay)
    .fadeOut(500);
}
/*
* 有资源 隐藏无资源提示
* 更新数量显示
* 如果标签是其他设置 隐藏底部按钮
*/
function UItoggle() {
  const size = getData().size;
  // 当前页面没有资源时 提示刷新页面
  $tips.hide();
  $noDataTip.toggle(size == 0);
  // 更新图标
  $(".faviconFlag").each(function () {
    const data = getData(this.getAttribute("requestId"));
    if (data && data.webUrl && favicon.has(data.webUrl)) {
      this.setAttribute("src", favicon.get(data.webUrl));
      this.classList.remove("faviconFlag");
    }
  });
  size >= 2 ? mergeDownButton() : $mergeDown.attr('disabled', true);
}
// 检查是否符合条件 更改 合并下载 按钮状态
function mergeDownButtonCheck(data) {
  if (!data.type) {
    return isMediaExt(data.ext);
  }
  return isMediaExt(data.ext) || data.type.startsWith("video") || data.type.startsWith("audio") || data.type.endsWith("octet-stream");
}
function mergeDownButton() {
  const [checkedData, maxSize] = getCheckedData();
  if (checkedData.length != 2 || (!G.isFirefox && maxSize > G.chromeLimitSize)) {
    // $mergeDown.hide();
    $mergeDown.attr('disabled', true);
    return;
  }
  if (checkedData.every(mergeDownButtonCheck) || checkedData.every(data => isM3U8(data))) {
    // $mergeDown.show();
    $mergeDown.removeAttr('disabled');
  }
}
// 获取当前标签 所有选择的文件
function getCheckedData() {
  const checkedData = [];
  let maxSize = 0;
  getData().forEach(function (data) {
    if (data.checked) {
      const size = data._size ?? 0;
      maxSize = size > maxSize ? size : maxSize;
      checkedData.push(data);
    }
  });
  return [checkedData, maxSize];
}
// 获取资源列表 存在requestId返回该资源
function getData(requestId = false) {
  if (requestId) {
    return allData.get(requestId);
  }
  return allData;
}

// 更新底部按钮高度
function updateDownHeight() {
  $(".container").css("margin-bottom", ($down[0].offsetHeight + 2) + "px");
}
