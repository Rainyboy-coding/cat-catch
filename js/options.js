////////////////////// 填充数据 //////////////////////
chrome.storage.sync.get(G.OptionLists, function (items) {
    if (chrome.runtime.lastError) {
        items = G.OptionLists;
    }
    // 确保有默认值
    for (let key in G.OptionLists) {
        if (items[key] === undefined || items[key] === null) {
            items[key] = G.OptionLists[key];
        }
    }
    if (items.Ext === undefined || items.Type === undefined || items.Regex === undefined) {
        location.reload();
    }
    if (G.isMobile) {
        $(`<link rel="stylesheet" type="text/css" href="css/mobile.css">`).appendTo("head");
    }
    const $extList = $("#extList");
    for (let key in items.Ext) {
        if (items.Ext[key].operator === undefined) {
            items.Ext[key].operator = ">=";
        }
        $extList.append(Gethtml("Ext", items.Ext[key]));
    }
    const $typeList = $("#typeList");
    for (let key in items.Type) {
        if (items.Type[key].operator === undefined) {
            items.Type[key].operator = ">=";
        }
        $typeList.append(Gethtml("Type", items.Type[key]));
    }
    const $regexList = $("#regexList");
    for (let key in items.Regex) {
        $regexList.append(Gethtml("Regex", items.Regex[key]));
    }
    const $blockUrlList = $("#blockUrlList");
    for (let key in items.blockUrl) {
        $blockUrlList.append(Gethtml("blockUrl", items.blockUrl[key]));
    }
    setTimeout(() => {
        for (let key in items) {
            if (key == "Ext" || key == "Type" || key == "Regex") { continue; }
            if (typeof items[key] == "boolean") {
                $(`#${key}`).prop("checked", items[key]);
            } else {
                $(`#${key}`).val(items[key]);
            }
        }
    }, 100);
});

//新增格式
$("#AddExt").bind("click", function () {
    $("#extList").append(Gethtml("Ext", { operator: ">=", state: true }));
    $("#extList [name=text]").last().focus();
});
$("#AddType").bind("click", function () {
    $("#typeList").append(Gethtml("Type", { operator: ">=", state: true }));
    $("#typeList [name=text]").last().focus();
});
$("#AddRegex").bind("click", function () {
    $("#regexList").append(Gethtml("Regex", { type: "ig", state: true }));
    $("#regexList [name=text]").last().focus();
});
$("#blockAddUrl").bind("click", function () {
    $("#blockUrlList").append(Gethtml("blockUrl", { state: true }));
    $("#blockUrlList [name=url]").last().focus();
});
$("#version").html(i18n.catCatch + " v" + chrome.runtime.getManifest().version);

// 增加后缀 类型 正则表达式
function Gethtml(Type, Param = new Object()) {
    let html = "";
    switch (Type) {
        case "Ext":
            html = `<td><input type="text" value="${Param.ext ? Param.ext : ""}" name="text" placeholder="${i18n.suffix}" class="ext"></td>`
            html += `<td><input type="text" value="${Param.operator == ">=" || Param.operator == "~" ? "" : Param.operator}${Param.size ? Param.size : 0} ${Param.unit ? Param.unit : "KB"}" class="size" name="size"></td>`
            break;
        case "Type":
            html = `<td><input type="text" value="${Param.type ? Param.type : ""}" name="text" placeholder="${i18n.type}" class="type"></td>`
            html += `<td><input type="text" value="${Param.operator == ">=" || Param.operator == "~" ? "" : Param.operator}${Param.size ? Param.size : 0} ${Param.unit ? Param.unit : "KB"}" class="size" name="size"></td>`
            break;
        case "Regex":
            html = `<td><input type="text" value="${Param.type ? Param.type : ""}" name="type" class="regexType"></td>`
            html += `<td><input type="text" value="${Param.regex ? Param.regex : ""}" placeholder="${i18n.regexExpression}" name="regex" class="regex"></td>`
            html += `<td><input type="text" value="${Param.ext ? Param.ext : ""}" name="regexExt" class="regexExt"></td>`
            html += `<td>
            <div class="switch">
                <label class="switchLabel switchRadius">
                    <input type="checkbox" name="blackList" class="switchInput" ${Param.blackList ? 'checked="checked"' : ""}/>
                    <span class="switchRound switchRadius"><em class="switchRoundBtn switchRadius"></em></span>
                </label>
            </div>
        </td>`
            break;
        case "blockUrl":
            html = `<td><input type="text" value="${Param.url ? Param.url : ""}" name="url" placeholder="${i18n.blockUrlTips}" class="width100"></td>`
            break;
    }
    html = $(`<tr data-type="${Type}">
            ${html}
            <td>
                <div class="switch">
                    <label class="switchLabel switchRadius">
                        <input type="checkbox" name="state" class="switchInput" ${Param.state ? 'checked="checked"' : ""}/>
                        <span class="switchRound switchRadius"><em class="switchRoundBtn switchRadius"></em></span>
                    </label>
                </div>
            </td>
            <td>
                <img src="img/delete.svg" class="RemoveButton">
            </td>
        </tr>`);
    html.find(".RemoveButton").click(function () {
        html.remove();
        Save(Type);
    });
    html.find("input").on("input", function () {
        Save(Type, 200);
    });
    html.find("[name=state]").on("click", function () {
        Save(Type);
    });
    if (Type == "Type") {
        html.find("input").blur(function () {
            $("#typeList tr").each(function () {
                let GetText = $(this).find("[name=text]").val();
                if (isEmpty(GetText)) { return true; }
                GetText = GetText.trim();
                const test = GetText.split("/");
                if (test.length != 2 || isEmpty(test[0]) || isEmpty(test[1])) {
                    alert(i18n.addTypeError);
                    return true;
                }
            });
        });
    }
    return html;
}
//失去焦点 保存自动清理数 模拟手机User Agent 自定义播放调用模板
let debounce2 = undefined;
$("[save='input']").on("input", function () {
    let val = $(this).val().trim();
    if (this.type == "number") {
        val = parseInt(val);
    }
    clearTimeout(debounce2);
    debounce2 = setTimeout(() => {
        chrome.storage.sync.set({ [this.id]: val });
    }, 300);
});
// 调试模式 使用网页标题做文件名 使用PotPlayer预览 显示网站图标 刷新自动清理
$("[save='click']").bind("click", function () {
    chrome.storage.sync.set({ [this.id]: this.checked });
});
// [save='select'] 元素 储存
$("[save='select']").on("change", function () {
    let val = $(this).val();
    if (!isNaN(val)) { val = parseInt(val); }
    chrome.storage.sync.set({ [this.id]: val });
});

// 一键禁用/启用
$("#allDisable, #allEnable").bind("click", function () {
    const state = this.id == "allEnable";
    const obj = $(this).data("switch");
    let query;
    if (obj == "Ext") {
        query = $("#extList [name=state]");
    } else if (obj == "Type") {
        query = $("#typeList [name=state]");
    } else if (obj == "Regex") {
        query = $("#regexList [name=state]");
    } else if (obj == "blockUrl") {
        query = $("#blockUrlList [name=state]");
    }
    query.each(function () {
        $(this).prop("checked", state);
    });
    Save(obj);
});
//重置后缀 重置类型 重置正则
$("[data-reset]").bind("click", function () {
    if (confirm(i18n.confirmReset)) {
        const Option = $(this).data("reset");
        chrome.storage.sync.set({ [Option]: G.OptionLists[Option] }, () => {
            location.reload();
        });
    }
});

//重置设置
$(".resetOption").click(function () {
    if (confirm(i18n.confirmReset)) {
        const optionBox = $(this).closest('.optionBox');
        const result = optionBox.find('[save]').toArray().reduce((acc, { id }) => {
            acc[id] = G.OptionLists[id];
            return acc;
        }, {});
        chrome.storage.sync.set(result, () => {
            location.reload();
        });
    }
});

//清空数据 重置所有设置
$("#ClearData, #ResetAllOption").bind("click", function () {
    if (this.id == "ResetAllOption") {
        if (confirm(i18n.confirmReset)) {
            chrome.storage.sync.clear();
            InitOptions();
        } else {
            return;
        }
    }
    chrome.storage.local.clear();
    chrome.storage.session.clear();
    chrome.runtime.sendMessage({ Message: "ClearIcon" });
    location.reload();
});

//重启扩展
$("#extensionReload").bind("click", function () {
    chrome.runtime.reload();
});
//正则表达式 测试
$("#testRegex, #testUrl").keyup(function () {
    const testUrl = $("#testUrl").val();
    const testRegex = $("#testRegex").val();
    const testFlag = $("#testFlag").val();
    if (testUrl == "" || testRegex == "") {
        $("#testResult").html(i18n.noMatch);
        return;
    }
    let regex;
    try {
        regex = new RegExp(testRegex, testFlag);
    } catch (e) {
        $("#testResult").html(e.message);
        return;
    }
    const result = regex.exec(testUrl);
    if (result == null) {
        $("#testResult").html(i18n.noMatch);
        return;
    }
    $("#testResult").html(i18n.match)
    for (let i = 1; i < result.length; i++) {
        if (result[i] != "") {
            $("#testResult").append(
                `<input type="text" style="width: 590px; color: #ff0000" value="${decodeURIComponent(result[i])}">`
            );
        }
    }
});
function SaveGetVal(Obj) {
    let text = Obj.find("[name=text]").val()?.trim();
    let size = Obj.find("[name=size]").val()?.trim();
    let state = Obj.find("[name=state]").prop("checked");

    // 提取size中的单位
    const unitMatch = size.match(/(KB|MB|GB|B|Byte)/i);
    let unit = "KB"; // 默认单位
    if (unitMatch) {
        unit = unitMatch[0].toUpperCase();
        size = size.replace(unitMatch[0], "").trim(); // 移除单位部分
    }

    // size 只保留操作符号 和 数字 和 范围符号 - 和 中间的空格
    size = size.replace(/[^\d><=!-\s]/g, "");

    let operator = ">=";    // 默认使用大于等于符号

    // 判断是否范围格式 如果存在 - 则分离 前后
    const rangeMatch = size.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) { operator = "~"; }

    // 比较符号
    const operatorMatch = size.match(/^(>=|<=|>|<|=|!=)/);
    if (operatorMatch) {
        operator = operatorMatch[0];
        size = parseInt(size.replace(operator, ""));
    }
    if (operator != "~") {
        size = parseInt(size);
        if (isNaN(size)) { size = 0; }
    }
    if (isEmpty(size)) { size = 0; }
    text = text.toLowerCase();

    return { text, size, operator, unit, state };
}

// 保存 后缀 类型 正则 配置
let debounce = undefined;
function Save(option, sec = 0) {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
        if (option == "Ext") {
            let Ext = new Array();
            $("#extList tr").each(function (index) {
                if (index === 0) return true;

                const { text, size, operator, unit, state } = SaveGetVal($(this));

                if (isEmpty(text)) { return true; }
                Ext.push({ ext: text, size, operator, unit, state });
            });
            chrome.storage.sync.set({ Ext: Ext });
            return;
        }
        if (option == "Type") {
            let Type = new Array();
            $("#typeList tr").each(function (index) {
                if (index === 0) return true;

                const { text, size, operator, unit, state } = SaveGetVal($(this));

                if (isEmpty(text)) { return true; }
                const test = text.split("/");
                if (test.length == 2 && !isEmpty(test[0]) && !isEmpty(test[1])) {
                    Type.push({ type: text, size, operator, unit, state });
                }
            });
            chrome.storage.sync.set({ Type: Type });
            return;
        }
        if (option == "Regex") {
            let Regex = new Array();
            $("#regexList tr").each(function (index) {
                if (index === 0) return true;

                const _this = $(this);
                let GetType = _this.find("[name=type]").val();
                let GetRegex = _this.find("[name=regex]").val();
                let GetExt = _this.find("[name=regexExt]").val()
                let GetState = _this.find("[name=state]").prop("checked");
                let GetBlackList = _this.find("[name=blackList]").prop("checked");
                try {
                    new RegExp("", GetType);
                } catch (e) {
                    GetType = "ig";
                }
                if (isEmpty(GetRegex)) { return true; }
                GetExt = GetExt ? GetExt.toLowerCase() : "";
                Regex.push({ type: GetType, regex: GetRegex, ext: GetExt, blackList: GetBlackList, state: GetState });
            });
            chrome.storage.sync.set({ Regex: Regex });
            return;
        }
        if (option == "blockUrl") {
            let blockUrl = new Array();
            $("#blockUrlList tr").each(function (index) {
                if (index === 0) return true;

                const _this = $(this);
                let url = _this.find("[name=url]").val();
                let GetState = _this.find("[name=state]").prop("checked");
                if (isEmpty(url)) { return true; }
                blockUrl.push({ url: url, state: GetState });
            });
            chrome.storage.sync.set({ blockUrl: blockUrl });
            return;
        }
    }, sec);
}

// 导航栏
document.querySelectorAll('nav a').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const targetId = this.getAttribute('href');
        const targetElement = document.querySelector(targetId);
        if (targetElement) {
            targetElement.scrollIntoView({
                behavior: 'smooth'
            });
        }
    });
});
const adjustSidebarPosition = () => {
    const wrapper = document.querySelector('.wrapper');
    const sidebar = document.querySelector('.sidebar');
    if (wrapper && sidebar) {
        sidebar.style.left = `${wrapper.getBoundingClientRect().left - sidebar.offsetWidth - 20}px`;
    }
}
window.addEventListener('load', adjustSidebarPosition)
window.addEventListener('resize', adjustSidebarPosition);
