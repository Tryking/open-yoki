# Binance's latest activity announcements for the between-shows radio: the public announcement list (catalog 93,
# latest activities) and each body as plain text, handed to the server (POST /api/square/facts). The host answers
# activity questions from these and nothing else, so she never makes up a reward. Public pages only, no login.
# Runs from livehost-facts.timer every 2 h, on a machine that can reach binance.com.
import json, re, time, urllib.request
from conf import server, LANG
H = {'lang': LANG, 'clienttype': 'web', 'user-agent': 'Mozilla/5.0'}
API = 'https://www.binance.com/bapi/composite/v1/public/cms/article'

def get(url):
    return json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=H), timeout=20).read())

def plain(body):
    out = []
    def walk(n):
        if isinstance(n, dict):
            if n.get('node') == 'text': out.append(n.get('text', ''))
            for v in n.values(): walk(v)
        elif isinstance(n, list):
            for v in n: walk(v)
    try: walk(json.loads(body)); t = ''.join(out)
    except Exception: t = re.sub(r'<[^>]+>', '', body or '')
    t = t.replace('这是一般性公告，此处提及的产品和服务可能不适用于您所在的地区。', '')
    return re.sub(r'\s+', ' ', t).strip()

def main():
    arts = [a for c in get(f'{API}/list/query?type=1&catalogId=93&pageNo=1&pageSize=20')['data']['catalogs'] for a in c['articles']]
    items = []
    for i, a in enumerate(arts[:20]):
        body = ''
        if i < 14:
            try: body = plain(get(f"{API}/detail/query?articleCode={a['code']}")['data'].get('body') or '')[:2400]
            except Exception as x: print('detail', a['code'][:8], type(x).__name__, flush=True)
            time.sleep(0.6)
        items.append({'title': a['title'], 'date': a['releaseDate'], 'body': body})
    # a reverse proxy may cap request bodies at 16 KB: one announcement per request, the first one resets the list
    r = None
    for i, it in enumerate(items):
        r = server('POST', '/api/square/facts', {'items': [it], 'reset': i == 0})
    print('facts', len(items), r, flush=True)

if __name__ == '__main__': main()
