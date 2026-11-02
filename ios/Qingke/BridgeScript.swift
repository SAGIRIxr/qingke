import Foundation

/// Document-start script for the timetable WebView only (never the school browser).
/// The web core calls `window.Android.*` exactly as on Android. Synchronous getters read a
/// cache that native code keeps current; every action is a message to a fixed native allowlist.
enum BridgeScript {
    static func source(initial: [String: Any], mirror: [String: String], demoState: String?) -> String {
        let initialJSON = json(initial), mirrorJSON = json(mirror), demoJSON = demoState.map { json(["value": $0]) } ?? "null"
        return """
        (function(){
          if (window.Android) return;
          var native = window.__qingkeNative = \(initialJSON);
          native.shareQueue = [];
          function post(method, args){ try { window.webkit.messageHandlers.qingke.postMessage({method: method, args: args || []}); } catch (e) {} }
          function text(value, max){ return typeof value === 'string' && value.trim() && value.length <= max; }
          window.__qingkeNativeUpdate = function(patch){ for (var key in patch) native[key] = patch[key]; };
          window.__qingkeNativeEnqueue = function(entries){ native.shareQueue = native.shareQueue.concat(entries).slice(-8); };
          var bridge = {
            platform: 'ios',
            getVersion: function(){ return native.version; },
            getNotificationStatus: function(){ return JSON.stringify(native.notificationStatus); },
            syncSchedule: function(json){ post('syncSchedule', [String(json)]); },
            requestNotifications: function(){ post('requestNotifications'); },
            openNotificationSettings: function(){ post('openNotificationSettings'); },
            testNotification: function(){ post('testNotification'); },
            exportBackup: function(json){ post('exportBackup', [String(json)]); },
            importBackup: function(){ post('importBackup'); },
            importPdf: function(){ post('importPdf'); },
            openSchool: function(url){ post('openSchool', [String(url)]); },
            shareRequest: function(id, action, base, payload){ post('shareRequest', [String(id), String(action), String(base), String(payload)]); },
            shareText: function(value){ if (!text(value, 16384)) return false; post('shareText', [value]); return true; },
            copyText: function(value){ if (!text(value, 16384)) return false; post('copyText', [value]); return true; },
            consumeShareLink: function(){ var entry = native.shareQueue.shift(); return entry ? JSON.stringify(entry) : ''; },
            getShareEntrySettings: function(){ return JSON.stringify(native.shareEntrySettings); },
            setClipboardShareEnabled: function(enabled){
              native.shareEntrySettings = {clipboardEnabled: !!enabled};
              if (!enabled) native.shareQueue = native.shareQueue.filter(function(entry){ return entry.source !== 'clipboard'; });
              post('setClipboardShareEnabled', [!!enabled]);
            }
          };
          window.addEventListener('error', function(e){ post('log', [String(e.message) + ' @ ' + String(e.filename || '') + ':' + String(e.lineno || '')]); });
          window.addEventListener('unhandledrejection', function(e){ post('log', ['unhandled: ' + String(e.reason && e.reason.message || e.reason)]); });
          Object.freeze(bridge);
          Object.defineProperty(window, 'Android', {value: bridge, writable: false, configurable: false});

          // localStorage mirror: restore after an iOS purge, then copy every qingke.* write to native.
          try {
            var storage = window.localStorage, mirror = \(mirrorJSON), demo = \(demoJSON), own = {}, hasOwn = false;
            for (var i = 0; i < storage.length; i++) { var name = storage.key(i); if (name.indexOf('qingke.') === 0) { hasOwn = true; own[name] = storage.getItem(name); } }
            if (!hasOwn && demo) { storage.setItem('qingke.data.v2', demo.value); own['qingke.data.v2'] = demo.value; hasOwn = true; }
            if (!hasOwn) { for (var key in mirror) if (key.indexOf('qingke.') === 0) storage.setItem(key, mirror[key]); }
            else post('mirrorReplace', [own]);
            var proto = Storage.prototype, setItem = proto.setItem, removeItem = proto.removeItem, clear = proto.clear;
            proto.setItem = function(key, value){ setItem.call(this, key, value); if (this === storage && String(key).indexOf('qingke.') === 0) post('mirrorSet', [String(key), String(value)]); };
            proto.removeItem = function(key){ removeItem.call(this, key); if (this === storage && String(key).indexOf('qingke.') === 0) post('mirrorRemove', [String(key)]); };
            proto.clear = function(){ clear.call(this); if (this === storage) post('mirrorClear'); };
          } catch (e) {}
        })();
        """
    }

    /// Same detached-clone capture as the Android school browser: no credentials, form values,
    /// scripts, URL tokens or cookies are ever collected.
    static let schoolCapture = #"""
    (function(){try{var parts=[],texts=[],seen=0,skipped=0;
    function read(doc,depth){if(!doc||!doc.body||depth>4||seen++>20)return;
    var copy=doc.body.cloneNode(true);
    copy.querySelectorAll('script,style,link,meta,input,textarea,select,button,iframe,frame,object,embed,svg,canvas,noscript').forEach(function(n){n.remove()});
    copy.querySelectorAll('*').forEach(function(n){Array.from(n.attributes).forEach(function(a){var safeData=a.name.indexOf('data-')===0&&!/(pass|pwd|secret|token|cookie|auth|session|credential)/i.test(a.name);if(['colspan','rowspan','class','id','title'].indexOf(a.name)<0&&!safeData)n.removeAttribute(a.name)});if(n.tagName==='BR')n.replaceWith(doc.createTextNode('\n'));if(/^(P|DIV|TR|LI|SECTION|H[1-6])$/.test(n.tagName))n.appendChild(doc.createTextNode('\n'));if(/^(TD|TH)$/.test(n.tagName))n.appendChild(doc.createTextNode('\t'))});
    parts.push(copy.innerHTML);texts.push(copy.textContent||'');
    doc.querySelectorAll('iframe,frame').forEach(function(f){try{if(f.contentDocument)read(f.contentDocument,depth+1);else skipped++}catch(e){skipped++}})}
    read(document,0);return JSON.stringify({url:location.origin+location.pathname,title:document.title,html:parts.join('\n').slice(0,2500000),text:texts.join('\n').slice(0,1000000),framesSkipped:skipped});
    }catch(e){return JSON.stringify({error:'无法读取当前页面，请进入课表页面后重试。'})}})()
    """#

    /// A JavaScript string literal for any text.
    static func literal(_ text: String) -> String { String(json([text]).dropFirst().dropLast()) }

    static func json(_ value: Any) -> String {
        guard JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(withJSONObject: value), var text = String(data: data, encoding: .utf8) else { return "null" }
        // U+2028/2029 are valid JSON but break older script parsers; "</" must not close a tag.
        text = text.replacingOccurrences(of: "\u{2028}", with: "\\u2028").replacingOccurrences(of: "\u{2029}", with: "\\u2029")
        return text.replacingOccurrences(of: "</", with: "<\\/")
    }
}
