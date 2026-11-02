// Which native shell hosts the timetable. The iOS shell injects window.Android with platform 'ios';
// a browser preview can force the iOS look with ?platform=ios.
function detect(){
  try{
    const native=globalThis.window?.Android?.platform;
    if(native)return native;
    if(/[?&]platform=ios(?:&|$)/.test(globalThis.location?.search||''))return 'ios';
    return globalThis.window?.Android?'android':'web';
  }catch{return 'web';}
}
export const platform=detect();
export const isIOS=platform==='ios';
if(isIOS)globalThis.document?.documentElement.classList.add('platform-ios');
