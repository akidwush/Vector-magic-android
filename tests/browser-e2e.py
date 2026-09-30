"""Static browser QA: uses a mocked upstream response but REAL DOM editor/preprocessing/import.
Requires: Python Playwright + installed Chromium; python tests/browser-e2e.py.
"""
import base64, json, os, pathlib, posixpath, re, traceback
from playwright.sync_api import sync_playwright
URL='http://127.0.0.1:8976/'
FILE=str(pathlib.Path('tests/fixtures/alpha.png').resolve())
SVG='''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100" width="120" height="100"><defs><linearGradient id="grad1"><stop offset="0%" stop-color="#14aa77"/><stop offset="100%" stop-color="#f3da40"/></linearGradient></defs><g id="colored" transform="translate(2 0)"><path id="p1" d="M0 20 C10 0 80 0 100 20 L100 70 Z" style="fill:url(#grad1)"/><circle cx="30" cy="40" r="8" fill="#22abcc"/></g></svg>'''
EMBEDDED = os.environ.get('VECTOR_EMBEDDED') == '1'
def mount_embedded_app(page):
    # This local sandbox denies every browser navigation. To verify the *actual*
    # original ESM graph anyway, map its imports to in-memory Blob URLs, then
    # load the real HTML/CSS and run the original module graph in Chromium.
    # about:blank is opaque-origin in this sandbox; emulate normal website storage.
    page.evaluate("""() => {const values = new Map();Object.defineProperty(window,'localStorage',{
      configurable:true,value:{getItem:k=>values.has(k)?values.get(k):null,
      setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k),clear:()=>values.clear()}})}""")
    root=pathlib.Path('.').resolve()
    source={}
    pattern=re.compile(r"""(?:(\bfrom\s*|\bimport\s*|\bexport\s*\*\s*from\s*)[\\\"'])([./][^\\\"']+)([\\\"'])""")
    # Simpler explicit patterns avoid transforming comment strings/unrelated URLs.
    for file in sorted((root/'src').rglob('*.js')):
        rel=file.relative_to(root).as_posix()
        text=file.read_text()
        def convert(match):
            pre,spec,post=match.groups()
            target=posixpath.normpath(posixpath.join(posixpath.dirname(rel),spec))
            assert (root/target).exists(), (rel,spec,target)
            return pre+post+'@vs/'+target+post
        source['@vs/'+rel]=pattern.sub(convert,text)
    mapping=page.evaluate('''src => Object.fromEntries(Object.entries(src).map(([key, js]) =>
      [key, URL.createObjectURL(new Blob([js],{type:'text/javascript'}))]))''',source)
    html=(root/'web/app.html').read_text()
    logo=base64.b64encode((root/'assets/hv_logo.svg').read_bytes()).decode()
    html=html.replace('/assets/hv_logo.svg','data:image/svg+xml;base64,'+logo)
    for css in ['style.css','studio.css']:
        html=html.replace('<link rel="stylesheet" href="/'+css+'" />',
                          '<style>'+ (root/'web'/css).read_text()+'</style>')
    html=html.replace('<script type="module" src="/src/app.js"></script>',
      '<script type="importmap">'+json.dumps({'imports':mapping})+'</script>'+
      '<script type="module">import("@vs/src/app.js").catch(e=>{window.__moduleError=e.stack||String(e);console.error(e.stack||e);});</script>')
    page.set_content(html,wait_until='domcontentloaded')

with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
  for width in [360,390,412,1080]:
    errors=[];requests=[]
    page=browser.new_page(viewport={'width':width,'height':760},device_scale_factor=1,has_touch=width<600,is_mobile=width<600)
    page.on('pageerror',lambda e:errors.append(str(e)))
    def intercept(route):
      r=route.request
      if r.method=='GET':route.fulfill(status=200,content_type='application/json',body=json.dumps({'ok':True,'colorEnabled':True,'siteKey':None}));return
      d=r.post_data_json;requests.append(d)
      assert d['action']=='color-trace'
      assert d['options']['colorPrecision']==6
      assert d['options']['speckleSize']==14
      raw=base64.b64decode(d['image'])
      assert raw.startswith(b'\x89PNG\r\n\x1a\n'),raw[:12]
      route.fulfill(status=200,content_type='application/json',body=json.dumps({'ok':True,'svg':SVG,'provider':'vector-ink'}))
    page.route('**/api/trace',intercept)
    if EMBEDDED:
      mount_embedded_app(page)
      # No URLs can navigate from this sandbox's about:blank, so stub only the
      # TRACE HTTP boundary; all frontend code is actual original modules.
      page.evaluate("""svg => {
        window.__traceRequests=[];
        window.fetch=async (url,opts={}) => {
          if (String(url)==='/api/trace') {
            if ((opts.method||'GET')==='GET')
              return new Response(JSON.stringify({ok:true,colorEnabled:true,siteKey:null}),{status:200,headers:{'Content-Type':'application/json'}});
            const body=JSON.parse(opts.body);window.__traceRequests.push(body);
            if (body.action!=='color-trace' || body.options.colorPrecision!==6 || body.options.speckleSize!==14 || !body.image.startsWith('iVBOR'))
              throw Error('Incorrect V1 frontend payload');
            return new Response(JSON.stringify({ok:true,svg,provider:'vector-ink'}),{status:200,headers:{'Content-Type':'application/json'}});
          }
          throw Error('No external network in embedded QA: '+String(url));
        }
      }""",SVG)
    else: page.goto(URL,wait_until='domcontentloaded',timeout=20000)
    page.locator('main.app').wait_for(state='visible',timeout=15000)
    page.wait_for_function('!!window.editor?.stage && !!window.vectorStudio',timeout=18000)
    if width==412:
      # Reproduce the Android failure reported from the live site: createImageBitmap
      # rejects and image blob: URLs fail. The third data-URL decoder must still work.
      page.evaluate("""() => {
        window.createImageBitmap=async()=>{throw new Error('simulated Android bitmap decoder failure')};
        const real=URL.createObjectURL.bind(URL);
        URL.createObjectURL=(blob)=>{
          if (blob && typeof blob.type==='string' && blob.type.startsWith('image/'))
            return 'blob:https://invalid.invalid/vector-studio-android';
          return real(blob);
        };
      }""")
    page.locator('#studio-trace-button').click()
    page.locator('#studio-trace-file').set_input_files(FILE)
    page.wait_for_function("!document.querySelector('#studio-trace-run').disabled",timeout=10000)
    if width==412:
      page.wait_for_function("document.querySelector('#studio-trace-original').src.startsWith('data:image/')",timeout=10000)
      print('PASS Android decoder fallback: detached bytes + data URL preview/decoder')
    page.locator('#studio-trace-run').click()
    page.locator('#studio-trace-dialog').wait_for(state='hidden',timeout=18000)
    doc=page.evaluate('''() => ({count:document.querySelectorAll('svg.inline-svg path').length,
      gradients:document.querySelectorAll('svg.inline-svg defs linearGradient').length,
      fill:document.querySelector('svg.inline-svg path')?.getAttribute('style'),
      name:document.querySelector('#output-label')?.textContent,appIsCloud:!!window.__HV_CLOUD__,
      editorStage:!!window.editor.stage,svgImages:window.editor.stage.querySelectorAll('image').length,
      overflow:document.documentElement.scrollWidth>innerWidth+2})''')
    assert doc['count']>0 and doc['gradients']>0,doc
    assert 'grad1' in doc['fill'],doc
    assert doc['appIsCloud'] and doc['editorStage'] and doc['svgImages']==0,doc
    assert not doc['overflow'],doc
    if width < 600:
      shell=page.evaluate("""() => {
        const rect=s=>document.querySelector(s)?.getBoundingClientRect();
        const css=s=>getComputedStyle(document.querySelector(s));
        const stage=rect('.stage-wrap'), manual=rect('#manual-trace-bar'), top=rect('#mobile-top'), status=rect('.status-bar');
        return {
          stageWidth:stage?.width||0, viewportWidth:innerWidth,
          manualDisplay:css('#manual-trace-bar').display,
          manualWidth:manual?.width||0,
          legacyToolsDisplay:css('.toolstrip').display,
          actionDisplay:css('.actionbar').display,
          topHeight:top?.height||0,statusHeight:status?.height||0,
          traceTop:rect('#studio-trace-button')?.top??999,
          manualButtons:document.querySelectorAll('#manual-trace-bar [data-manual-tool]').length,
          fillVisible:(rect('#manual-fill')?.width||0)>0,
          strokeVisible:(rect('#manual-stroke')?.width||0)>0
        };
      }""")
      assert shell['stageWidth'] >= width-2,shell
      assert shell['manualDisplay']=='flex' and shell['manualWidth'] >= width-2,shell
      assert shell['legacyToolsDisplay']=='none',shell
      assert shell['actionDisplay']=='none',shell
      assert shell['manualButtons']==3 and shell['fillVisible'] and shell['strokeVisible'],shell
      assert shell['topHeight'] <= 56 and shell['statusHeight'] <= 36,shell
      assert shell['traceTop'] < 16,shell
      # Manual Trace Step 2: Pen canvas is touch-locked; Control Pad owns placement.
      page.locator('#manual-trace-bar [data-manual-tool="pen"]').click()
      page.wait_for_function("""window.editor.tool==='pen'
        && window.editor._manualTraceTouchMode==='pen'
        && !document.querySelector('#manual-control-pad').hidden
        && document.querySelector('#manual-trace-bar [data-manual-tool=pen]').getAttribute('aria-pressed')==='true'""")
      svg_box=page.locator('svg.inline-svg').bounding_box()
      assert svg_box, 'SVG stage has no box'
      page.touchscreen.tap(svg_box['x']+svg_box['width']*.55,svg_box['y']+svg_box['height']*.55)
      assert page.evaluate('window.editor._pen===null'), 'canvas touch illegally started Pen path'

      cursor0=page.evaluate('window.manualTraceUI.getCursor()')
      pad_box=page.locator('#manual-pad-surface').bounding_box()
      assert pad_box, 'Control Pad has no box'
      # Swipe is relative cursor movement and must NOT place a point.
      x=pad_box['x']+pad_box['width']*.42;y=pad_box['y']+pad_box['height']*.50
      page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+46,y+18,steps=4);page.mouse.up()
      cursor1=page.evaluate('window.manualTraceUI.getCursor()')
      assert abs(cursor1['x']-cursor0['x'])+abs(cursor1['y']-cursor0['y'])>0.1,(cursor0,cursor1)
      assert page.evaluate('window.editor._pen===null'), 'Control Pad swipe illegally placed point'

      # Tap Control Pad = one real Hector Pen anchor.
      page.locator('#manual-pad-surface').click(position={'x':pad_box['width']*.50,'y':pad_box['height']*.50})
      page.wait_for_function("window.editor._pen?.pts?.length===1")
      # Direct canvas touch stays blocked even while a path is in progress.
      page.touchscreen.tap(svg_box['x']+svg_box['width']*.35,svg_box['y']+svg_box['height']*.35)
      assert page.evaluate('window.editor._pen?.pts?.length===1'), 'canvas touch added an anchor'

      # Move crosshair elsewhere, tap second point, then finish the open path.
      page.mouse.move(x,y);page.mouse.down();page.mouse.move(x-52,y+32,steps=4);page.mouse.up()
      page.locator('#manual-pad-surface').click(position={'x':pad_box['width']*.52,'y':pad_box['height']*.52})
      page.wait_for_function("window.editor._pen?.pts?.length===2 && !document.querySelector('#manual-finish-path').disabled")
      page.locator('#manual-finish-path').click()
      page.wait_for_function("window.editor._pen===null && window.editor.selection.size===1")

      # Edit Points: no viewport gesture; only enlarged anchor/Bezier handles are touch targets.
      page.locator('#manual-trace-bar [data-manual-tool="node"]').click()
      page.wait_for_function("""window.editor.tool==='node'
        && window.editor._manualTraceTouchMode==='node'
        && document.querySelector('.hv-node-anchor')""")
      node_box=page.locator('.hv-node-anchor').first.bounding_box()
      assert node_box and node_box['width']>=15 and node_box['height']>=15,node_box
      page.touchscreen.tap(node_box['x']+node_box['width']/2,node_box['y']+node_box['height']/2)
      page.wait_for_function("window.editor._nodeSel?.size>=1")
      # Background touch in Edit Points cannot start pinch/pan or create geometry.
      page.touchscreen.tap(svg_box['x']+4,svg_box['y']+4)
      assert not page.evaluate('Boolean(window.editor._touchGesture)')
      page.locator('#manual-trace-bar [data-manual-tool="select"]').click()
      page.wait_for_function("window.editor.tool==='select' && window.editor._manualTraceTouchMode===null")
      page.evaluate('window.editor.undo()')  # remove QA manual path; keep traced document
      print(f'PASS Manual Trace Step 2 {width}px: touch lock + Control Pad + node correction')
    actual_requests=page.evaluate('window.__traceRequests') if EMBEDDED else requests
    assert len(actual_requests)==1,actual_requests
    if width==412:
      target='@vs/src/trace/sanitize.js' if EMBEDDED else '/src/trace/sanitize.js'
      safe=page.evaluate("""async target => {
        const {sanitizeVectorSvg}=await import(target);
        return sanitizeVectorSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>window.pwned=1</script><path d="M0 0L9 9" onload="alert(1)" style="fill:url(https://evil.invalid/a)"/></svg>');
      }""",target)
      assert '<script' not in safe and 'onload' not in safe and 'evil.invalid' not in safe and '<path' in safe,safe
      assert not page.evaluate('Boolean(window.pwned)')
      print('PASS SVG sanitization: removed script, event handlers, remote paint URLs')

    if width==390:
      page.screenshot(path='/tmp/vector-studio-canvas-preview.png')
      # Existing drawing must not be destroyed, defs must be re-minted for new import.
      page.evaluate("window.editor.placeSvgMarkup('<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 120 100\"><rect x=\"3\" y=\"4\" width=\"11\" height=\"12\" fill=\"#ff3344\"/></svg>', 'user-shape')")
      before=page.evaluate('window.editor.stage.querySelectorAll("rect:not(.hv-artboard)").length')
      page.locator('#studio-trace-button').click();page.locator('#studio-trace-file').set_input_files(FILE)
      page.wait_for_function("!document.querySelector('#studio-trace-run').disabled",timeout=10000)
      page.locator('#studio-trace-run').click()
      page.locator('#studio-trace-dialog').wait_for(state='hidden',timeout=18000)
      after=page.evaluate(r'''() => ({beforeRect:window.editor.stage.querySelectorAll('rect:not(.hv-artboard)').length,
        groups:window.editor.stage.querySelectorAll('g[data-hv-name^="Trace:"]').length,
        grads:window.editor.stage.querySelectorAll('defs linearGradient').length,
        validRef:[...window.editor.stage.querySelectorAll('g[data-hv-name^="Trace:"] path')].some(x=>/url\(#hvtrace/.test(x.getAttribute('style')||'')),
        sel:[...window.editor.selection].length})''')
      assert after['beforeRect']==before and after['groups']>0 and after['grads']>=2 and after['validRef'] and after['sel']>0,after
      # Undo keeps original user content, loses the last trace batch.
      page.evaluate('window.editor.undo()')
      remaining=page.evaluate('window.editor.stage.querySelectorAll("g[data-hv-name^=\\"Trace:\\"]").length')
      assert remaining==0,remaining
      print('PASS existing canvas: preserved original objects + gradient defs + editable selection + undo')
    print(f'PASS browser {width}px: {doc} POST requests={len(actual_requests)}')
    assert not errors,errors
    page.close()
  browser.close()
