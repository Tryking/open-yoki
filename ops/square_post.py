# The host's own Square posts. Her heart writes a post on the Node server, the server checks it (no contract
# addresses, no links, within today's count) and queues it; this asks for what is queued, posts it through Square's
# official OpenAPI (SQUARE_OPENAPI_KEY, made in the creator center; text only) and reports back once
# (POST /api/square/outbox/done). Without a key it does nothing and the queue stays on the server.
# X is posted by the server itself through the official X API.
# Runs from livehost-post.timer every 2 min. The key is never printed.
#   python3 square_post.py          once
#   python3 square_post.py check    say whether the OpenAPI key is present
import json, sys, time, urllib.error, urllib.request
from conf import E, server
ADD = 'https://www.binance.com/bapi/composite/v1/public/pgc/openApi/content/add'
STALE_MS = 6 * 3600e3   # a post queued and never sent for 6 h is out of date: hand it back

def log(*a): print(time.strftime('%H:%M:%S'), *a, flush=True)

def openapi(key, text):
    req = urllib.request.Request(ADD, data=json.dumps({'contentType': 1, 'bodyTextOnly': text}).encode(), method='POST',
                                 headers={'X-Square-OpenAPI-Key': key, 'Content-Type': 'application/json', 'clienttype': 'binanceSkill'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r: raw = r.read()
    except urllib.error.HTTPError as e:
        if e.code == 504: return True, None, None          # Square's gateway timed out but the post went through
        return False, None, 'HTTP %d %s' % (e.code, e.read()[:120].decode('utf8', 'replace'))
    except Exception as e:
        return None, None, str(e)[:120]                     # unknown: maybe posted, maybe not
    j = json.loads(raw)
    if j.get('code') != '000000': return False, None, 'API error [%s] %s' % (j.get('code'), str(j.get('message'))[:100])
    return True, (j.get('data') or {}).get('shareLink'), None

def main():
    key = E.get('SQUARE_OPENAPI_KEY') or ''
    if not key: return   # no OpenAPI key: nothing goes to Square
    try: items = server('GET', '/api/square/outbox').get('items', [])
    except OSError: return   # main program not running: nothing to post
    for it in items:
        try: age = time.time() * 1000 - int(it['id'][1:])
        except ValueError: age = 0
        if age > STALE_MS:
            server('POST', '/api/square/outbox/done', {'id': it['id'], 'ok': False, 'error': '放太久了（排了 %d 小时没发出去），内容可能过时了，想发就重写一条' % (age // 3600e3)})
            log('post', it['id'], 'stale, handed back'); continue
        ok, link, err = openapi(key, it['text'])
        if ok is None:
            log('post', it['id'], 'unknown:', err); continue   # the server calls it "not sure" after 30 min
        note = ('广场 ' + (link or '发了')) if ok else '广场没发（%s）' % err
        server('POST', '/api/square/outbox/done', {'id': it['id'], 'ok': ok, 'link': note if ok else None, 'error': None if ok else note})
        log('post', it['id'], 'ok' if ok else 'failed', note)

if __name__ == '__main__':
    if sys.argv[1:2] == ['check']: print('square openapi key', 'present' if E.get('SQUARE_OPENAPI_KEY') else 'missing (nothing is posted on Square)')
    else: main()
