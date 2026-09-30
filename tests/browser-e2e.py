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
    if width < 600:
      page.locator('#mobile-add-fab').click()
      page.wait_for_function("!document.querySelector('#mobile-add-sheet').hidden")
      page.locator('[data-add-tab="media"]').click()
      page.locator('#mobile-trace-open').click()
    else:
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
        const stage=rect('.stage-wrap'), top=rect('#mobile-top'), fab=rect('#mobile-add-fab');
        return {
          stageWidth:stage?.width||0, viewportWidth:innerWidth,
          manualDisplay:css('#manual-trace-bar').display,
          legacyToolsDisplay:css('.toolstrip').display,
          actionDisplay:css('.actionbar').display,
          topHeight:top?.height||0,
          addFab:fab?.width||0,
          studioActions:css('.studio-actions').display
        };
      }""")
      assert shell['stageWidth'] >= width-2,shell
      assert shell['manualDisplay']=='none',shell
      assert shell['legacyToolsDisplay']=='none' and shell['actionDisplay']=='none',shell
      assert shell['topHeight'] <= 56 and 52<=shell['addFab']<=60,shell
      assert shell['studioActions']=='none',shell

      # Alight-style + shell: Shape / Media / Vector Drawing only.
      page.locator('#mobile-add-fab').click()
      page.wait_for_function("!document.querySelector('#mobile-add-sheet').hidden")
      tabs=page.locator('#mobile-add-sheet [data-add-tab]').all_text_contents()
      assert tabs==['○△□♡Shape','▧Media','✒Vector Drawing'],tabs

      # Quick Rectangle stays parametric: round it directly from the object panel,
      # then delete the selected SVG layer without entering Edit Points.
      before_paths=page.evaluate("window.editor.stage.querySelectorAll('path').length")
      page.locator('[data-add-shape="rect"]').click()
      page.wait_for_function("""!document.querySelector('#mobile-object-sheet').hidden
        && window.editor.selection.size===1
        && window.editor.selectedNodes()[0]?.getAttribute('data-hv-shape')==='rect'
        && !document.querySelector('#mobile-shape-quick').hidden""")
      after_paths=page.evaluate("window.editor.stage.querySelectorAll('path').length")
      assert after_paths==before_paths+1,(before_paths,after_paths)
      d0=page.evaluate("window.editor.selectedNodes()[0].getAttribute('d')")
      page.evaluate("""() => {
        const r=document.querySelector('#mobile-shape-round');
        r.value='72';r.dispatchEvent(new Event('input',{bubbles:true}));r.dispatchEvent(new Event('change',{bubbles:true}));
      }""")
      page.wait_for_function("""() => {
        const n=window.editor.selectedNodes()[0];
        return parseFloat(n?.getAttribute('data-hv-r')||0)>0;
      }""")
      rounded=page.evaluate("""() => {
        const n=window.editor.selectedNodes()[0];
        return {d:n.getAttribute('d'),r:parseFloat(n.getAttribute('data-hv-r')||0),
          exportLeaks:/data-hv-(shape|r|bx|by|bw|bh)/.test(window.editor.serialize())};
      }""")
      assert rounded['r']>0 and rounded['d']!=d0 and not rounded['exportLeaks'],rounded
      actions=page.locator('#mobile-object-grid [data-object-action]').all_text_contents()
      assert actions==['◒Color & Fill','▣Border & Shadow','◇Blending & Opacity','↔Move & Transform','♢Edit Points'],actions
      assert 'Preset' not in ''.join(actions) and 'Effect' not in ''.join(actions),actions
      page.locator('#mobile-object-delete').click()
      page.wait_for_function(f"window.editor.stage.querySelectorAll('path').length==={before_paths} && window.editor.selection.size===0")

      # Media reference is kept on the live canvas but explicitly stripped from SVG export.
      page.locator('#mobile-add-fab').click()
      page.locator('[data-add-tab="media"]').click()
      page.locator('#mobile-reference-pick').click()
      page.locator('#mobile-reference-file').set_input_files(FILE)
      page.wait_for_function("""window.editor.stage.querySelector('image[data-vs-reference="1"]')""")
      ref_export=page.evaluate("""() => ({live:!!window.editor.stage.querySelector('image[data-vs-reference="1"]'),
        exported:/<image\\b/i.test(window.editor.serialize()),
        marker:/data-vs-reference/i.test(window.editor.serialize())})""")
      assert ref_export['live'] and not ref_export['exported'] and not ref_export['marker'],ref_export
      page.evaluate("window.editor.undo()")

      # Enter the existing vector engine from the third + tab; from here all
      # Control Pad / Contour / Bezier QA continues unchanged.
      page.locator('#mobile-add-fab').click()
      page.locator('[data-add-tab="vector"]').click()
      page.locator('#mobile-vector-draw').click()
      page.wait_for_function("""window.editor.tool==='pen'
        && window.editor._manualTraceTouchMode==='pen'
        && !document.querySelector('#manual-control-pad').hidden
        && !document.querySelector('#manual-vector-head').hidden
        && document.querySelector('#manual-trace-bar [data-manual-tool=pen]').getAttribute('aria-pressed')==='true'""")
      immersive=page.evaluate(r'''() => {
        const r=s=>document.querySelector(s)?.getBoundingClientRect();
        const stage=r('.stage-wrap'),pad=r('#manual-control-pad');
        return {head:getComputedStyle(document.querySelector('#manual-vector-head')).display,
          mobile:getComputedStyle(document.querySelector('#mobile-top')).display,
          rulers:getComputedStyle(document.querySelector('#rulers')).display,
          stageBottom:stage?.bottom||0,padTop:pad?.top||0,padBottom:pad?.bottom||0};
      }''')
      assert immersive['head']!='none' and immersive['mobile']=='none' and immersive['rulers']=='none',immersive
      assert immersive['padTop']>=immersive['stageBottom']-2,immersive
      svg_box=page.locator('svg.inline-svg').bounding_box()
      assert svg_box, 'SVG stage has no box'
      page.touchscreen.tap(svg_box['x']+svg_box['width']*.55,svg_box['y']+svg_box['height']*.55)
      assert page.evaluate('window.editor._pen===null'), 'canvas touch illegally started Pen path'

      # Navigation Step 1: the magnifier is an explicit mode switch. Draw remains
      # locked by default; Pan & Zoom consumes canvas touches without creating geometry.
      nav_box=page.locator('#manual-nav-toggle').bounding_box()
      assert nav_box and nav_box['width']>=40,nav_box
      page.locator('#manual-nav-toggle').click()
      page.wait_for_function("""window.editor._manualTraceNavMode===true
        && document.querySelector('#manual-nav-toggle').getAttribute('aria-pressed')==='true'
        && document.querySelector('main.app').classList.contains('manual-panzoom-mode')""")
      nav_result=page.evaluate(r'''() => {
        const el=document.querySelector('#output-preview');
        const content=el.querySelector('.viewport-content');
        const r=el.getBoundingClientRect();
        const fire=(type,id,x,y)=>el.dispatchEvent(new PointerEvent(type,{
          bubbles:true,cancelable:true,composed:true,pointerId:id,pointerType:'touch',
          button:0,buttons:(type==='pointerup'||type==='pointercancel')?0:1,
          clientX:x,clientY:y
        }));
        const read=()=>content?.style.transform||'';
        const before=read(),cx=r.left+r.width*.52,cy=r.top+r.height*.48;
        fire('pointerdown',901,cx,cy);
        fire('pointermove',901,cx+38,cy+21);
        fire('pointerup',901,cx+38,cy+21);
        const afterPan=read();
        fire('pointerdown',902,cx-38,cy);
        fire('pointerdown',903,cx+38,cy);
        fire('pointermove',902,cx-66,cy-5);
        fire('pointermove',903,cx+66,cy+5);
        fire('pointerup',902,cx-66,cy-5);
        fire('pointerup',903,cx+66,cy+5);
        return {before,afterPan,afterPinch:read(),gesture:Boolean(window.editor._touchGesture),
          pen:Boolean(window.editor._pen)};
      }''')
      assert nav_result['afterPan']!=nav_result['before'],nav_result
      assert nav_result['afterPinch']!=nav_result['afterPan'],nav_result
      assert not nav_result['gesture'] and not nav_result['pen'],nav_result
      page.locator('#manual-nav-toggle').click()
      page.wait_for_function("window.editor._manualTraceNavMode===false && document.querySelector('#manual-nav-toggle').getAttribute('aria-pressed')==='false'")
      page.evaluate("""() => document.querySelector('[data-vp="output"][data-action="fit"]')?.click()""")

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
      if width==390:
        # Keep Contour 1 with a real middle anchor so Step 5 can exercise two-sided Bezier handles.
        page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+26,y-44,steps=4);page.mouse.up()
        page.locator('#manual-pad-surface').click(position={'x':pad_box['width']*.48,'y':pad_box['height']*.46})
        page.wait_for_function("window.editor._pen?.pts?.length===3")
      page.locator('#manual-finish-path').click()
      page.wait_for_function("window.editor._pen===null && window.editor.selection.size===1")

      # Step 4 on 390px: mobile Fill/Stroke must edit the remembered Vector Layer
      # directly, not depend on Hector's hidden Colour dock selection state.
      if width==390:
        page.locator('#manual-fill').click()
        page.wait_for_function("""!document.querySelector('#manual-paint-sheet').hidden
          && document.querySelector('main.app').classList.contains('manual-paint-open')
          && document.querySelector('#manual-paint-title').textContent.includes('Color')""")
        hex_in=page.locator('#manual-paint-picker input[data-k="hex"]')
        hex_in.fill('33cc88')
        page.wait_for_function("""(window.editor.manualVectorLayerTarget()?.getAttribute('fill')||'').toLowerCase()==='#33cc88'""")
        page.locator('#manual-paint-back').click()
        page.wait_for_function("document.querySelector('#manual-paint-sheet').hidden")

        page.locator('#manual-stroke').click()
        page.wait_for_function("""!document.querySelector('#manual-paint-sheet').hidden
          && !document.querySelector('#manual-stroke-width').hidden""")
        page.evaluate("""() => {
          const r=document.querySelector('#manual-stroke-range');
          r.value='4';r.dispatchEvent(new Event('input',{bubbles:true}));
        }""")
        page.locator('#manual-paint-picker input[data-k="hex"]').fill('ff3366')
        page.wait_for_function("""() => {
          const p=window.editor.manualVectorLayerTarget();
          return (p?.getAttribute('stroke')||'').toLowerCase()==='#ff3366'
            && Math.abs(parseFloat(p?.getAttribute('stroke-width')||0)-4)<0.01;
        }""")
        page.locator('#manual-paint-back').click()
        paint_state=page.evaluate("""() => {
          const p=window.editor.manualVectorLayerTarget();
          return {fill:p.getAttribute('fill'),stroke:p.getAttribute('stroke'),width:p.getAttribute('stroke-width'),
            fillChip:document.querySelector('#manual-fill').style.getPropertyValue('--manual-paint'),
            strokeChip:document.querySelector('#manual-stroke').style.getPropertyValue('--manual-paint')};
        }""")
        assert paint_state['fill'].lower()=='#33cc88' and paint_state['stroke'].lower()=='#ff3366' and float(paint_state['width'])==4,paint_state
        print('PASS Manual Trace Step 4 390px: live Fill + Stroke + width use active Vector Layer')

      # Step 3 on 390px: append a second contour to the SAME Vector Layer, use the
      # Contour Scroller to focus it, edit it, and verify standard SVG export keeps both.
      if width==390:
        page.wait_for_function("""!document.querySelector('#manual-contour-dock').hidden
          && window.editor.manualVectorLayerContours().contours.length===1""")
        page.locator('#manual-contour-title').click()
        page.locator('#manual-add-contour').click()
        page.wait_for_function("window.editor._pen?.contourAppend===true")
        # Two-point open contour is enough to validate compound-path storage/edit/export.
        page.locator('#manual-pad-surface').click(position={'x':pad_box['width']*.46,'y':pad_box['height']*.44})
        page.wait_for_function("window.editor._pen?.pts?.length===1")
        page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+58,y-34,steps=4);page.mouse.up()
        page.locator('#manual-pad-surface').click(position={'x':pad_box['width']*.54,'y':pad_box['height']*.55})
        page.wait_for_function("window.editor._pen?.pts?.length===2")
        page.locator('#manual-finish-path').click()
        page.wait_for_function("""window.editor._pen===null
          && window.editor.manualVectorLayerContours().contours.length===2
          && document.querySelector('#manual-contour-range').max==='2'""")
        compound=page.evaluate(r'''() => {
          const p=window.editor.manualVectorLayerTarget();
          const d=p.getAttribute('d')||'';
          return {paths:window.editor.stage.querySelectorAll('path').length,
            moves:(d.match(/M/g)||[]).length,d,
            range:document.querySelector('#manual-contour-range').max};
        }''')
        assert compound['moves']==2 and compound['range']=='2',compound

        # Use the actual Contour Scroller to select Contour 2.
        page.evaluate("""() => {
          const r=document.querySelector('#manual-contour-range');
          r.value='2';r.dispatchEvent(new Event('input',{bubbles:true}));
        }""")
        page.wait_for_function("""window.editor.tool==='node'
          && window.editor._manualContourFocus?.sub===1
          && window.editor._nodeEls?.size===2
          && [...window.editor._nodeEls.values()].every(x=>x.nd.sub===1)""")

        # Select one node, then move it through the Alight-style Control Pad.
        # Contour 1's serialized subpath must remain byte-identical.
        before_parts=page.evaluate("""() => (window.editor.manualVectorLayerTarget().getAttribute('d')||'').match(/M[^M]*/g)""")
        focused=page.locator('.hv-node-anchor').first.bounding_box()
        assert focused, 'focused contour has no node handle'
        page.touchscreen.tap(focused['x']+focused['width']/2,focused['y']+focused['height']/2)
        page.wait_for_function("window.editor.manualSelectedNodeCount()===1")
        node_pad=page.locator('#manual-pad-surface').bounding_box()
        assert node_pad, 'Edit Points Control Pad missing'
        px=node_pad['x']+node_pad['width']*.45;py=node_pad['y']+node_pad['height']*.5
        page.mouse.move(px,py);page.mouse.down();page.mouse.move(px+42,py+22,steps=5);page.mouse.up()
        after_parts=page.evaluate("""() => (window.editor.manualVectorLayerTarget().getAttribute('d')||'').match(/M[^M]*/g)""")
        assert len(before_parts)==2 and len(after_parts)==2 and before_parts[0]==after_parts[0] and before_parts[1]!=after_parts[1],(before_parts,after_parts)

        exported=page.evaluate(r'''() => {
          const layer=window.editor.manualVectorLayerTarget();
          const live=layer.getAttribute('d')||'';
          const xml=window.editor.serialize();
          const doc=new DOMParser().parseFromString(xml,'image/svg+xml');
          const ds=[...doc.querySelectorAll('path')].map(p=>p.getAttribute('d')||'');
          return {liveMoves:(live.match(/M/g)||[]).length,
            matching:ds.filter(d=>d===live).length,
            exportedMoves:ds.map(d=>(d.match(/M/g)||[]).length).sort((a,b)=>b-a)[0]||0,
            leaks:/data-vs-|manual-contour/i.test(xml)};
        }''')
        assert exported['liveMoves']==2 and exported['matching']==1 and exported['exportedMoves']>=2 and not exported['leaks'],exported
        print('PASS Manual Trace Step 3 390px: Add Contour + scroller focus + isolated edit + compound SVG export')

        # Step 5: Curve/Bezier actions all run through the lower Control Pad.
        step5_history=page.evaluate('window.editor.history.length')
        page.evaluate("""() => {
          const r=document.querySelector('#manual-contour-range');
          r.value='1';r.dispatchEvent(new Event('input',{bubbles:true}));
        }""")
        page.wait_for_function("""window.editor._manualContourFocus?.sub===0
          && window.editor._nodeEls?.size===3
          && !document.querySelector('#manual-bezier-tools').hidden""")
        bezier_box=page.locator('#manual-bezier-tools').bounding_box()
        assert bezier_box and bezier_box['width']>=80,bezier_box

        # Select the middle corner and turn it into a smooth point.
        mid=page.locator('.hv-node-anchor').nth(1).bounding_box()
        assert mid,'middle anchor missing'
        page.touchscreen.tap(mid['x']+mid['width']/2,mid['y']+mid['height']/2)
        page.wait_for_function("window.editor.manualSelectedNodeCount()===1 && window.editor.manualSelectedAnchorState().corner")
        page.locator('[data-bezier-action="smooth"]').click()
        page.wait_for_function("""window.editor.manualSelectedAnchorState().smooth
          && window.editor.manualSelectedAnchorState().in
          && window.editor.manualSelectedAnchorState().out""")

        # Mirror = equal opposite handles; Control Pad moves OUT and mirrors IN.
        page.locator('[data-bezier-action="mirror"]').click()
        page.wait_for_function("""window.manualTraceUI.getBezierMode().handleRelation==='mirror'
          && window.editor.manualSelectedAnchorState().mirrored
          && !document.querySelector('#manual-handle-side').hidden""")
        h0=page.evaluate("window.editor.manualSelectedAnchorState()")
        node_pad=page.locator('#manual-pad-surface').bounding_box()
        px=node_pad['x']+node_pad['width']*.48;py=node_pad['y']+node_pad['height']*.50
        page.mouse.move(px,py);page.mouse.down();page.mouse.move(px+34,py-19,steps=4);page.mouse.up()
        page.wait_for_function("window.editor.manualSelectedAnchorState().mirrored")
        h1=page.evaluate("window.editor.manualSelectedAnchorState()")
        assert h1['out']!=h0['out'],(h0,h1)

        # Break = the chosen OUT handle moves independently, IN stays put.
        page.locator('[data-bezier-action="break"]').click()
        page.wait_for_function("window.manualTraceUI.getBezierMode().handleRelation==='break'")
        b0=page.evaluate("window.editor.manualSelectedAnchorState()")
        page.mouse.move(px,py);page.mouse.down();page.mouse.move(px-27,py+31,steps=4);page.mouse.up()
        b1=page.evaluate("window.editor.manualSelectedAnchorState()")
        assert b1['in']==b0['in'] and b1['out']!=b0['out'],(b0,b1)
        assert b1['broken'],b1

        # IN/OUT side switch is explicit; Corner retracts both handles again.
        page.locator('[data-handle-side="in"]').click()
        page.wait_for_function("window.manualTraceUI.getBezierMode().handleSide==='in'")
        page.locator('[data-bezier-action="corner"]').click()
        page.wait_for_function("window.editor.manualSelectedAnchorState().corner")

        # Add Point: crosshair is positioned with Control Pad state, tap inserts a real
        # anchor on Contour 1; Delete removes that selected inserted anchor.
        before_add=page.evaluate("window.editor._nodeEls.size")
        midseg=page.evaluate("""() => {
          const a=[...window.editor._nodeEls.values()].map(x=>({x:x.nd.x,y:x.nd.y}));
          return {x:(a[0].x+a[1].x)/2,y:(a[0].y+a[1].y)/2};
        }""")
        page.locator('[data-bezier-action="add"]').click()
        page.wait_for_function("window.manualTraceUI.getBezierMode().nodeAction==='add' && document.querySelector('.manual-trace-crosshair')")
        page.evaluate("(p)=>window.manualTraceUI.setCursor(p)",midseg)
        page.locator('#manual-pad-surface').click(position={'x':node_pad['width']*.50,'y':node_pad['height']*.50})
        page.wait_for_function(f"window.editor._nodeEls.size==={before_add+1} && window.editor.manualSelectedNodeCount()===1")
        page.locator('[data-bezier-action="delete"]').click()
        page.wait_for_function(f"window.editor._nodeEls.size==={before_add}")

        # All Step 5 changes are ordinary history entries and round-trip back to the
        # exact pre-Step-5 compound path; later legacy QA can continue unchanged.
        page.evaluate("""base => {
          while(window.editor.history.length>base) window.editor.undo();
          window.manualTraceUI.syncTool();
        }""",step5_history)
        page.wait_for_function("""window.editor._manualContourFocus?.sub===0
          && window.editor._nodeEls?.size===3""")
        print('PASS Manual Trace Step 5 390px: Corner + Smooth + Mirror + Break + Add/Delete through Control Pad')

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
      page.locator('#manual-vector-back').click()
      page.wait_for_function("window.editor.tool==='select' && window.editor._manualTraceTouchMode===null && document.querySelector('#manual-vector-head').hidden")
      if width==390:
        # remove Control-Pad node edit, appended contour, Stroke, Fill, then initial manual path
        page.evaluate('window.editor.undo();window.editor.undo();window.editor.undo();window.editor.undo();window.editor.undo()')
      else:
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
