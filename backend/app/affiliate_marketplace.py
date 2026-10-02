"""Marketplace option names, category mapping and percentage pricing."""
import re
import unicodedata
from decimal import Decimal, ROUND_HALF_UP
from html.parser import HTMLParser


def normalized(value):
    return ''.join(c for c in unicodedata.normalize('NFKD', str(value or '').lower()) if not unicodedata.combining(c))


def product_category(product):
    metadata = normalized(str(product.get('product_type', '')) + ' ' + str(product.get('tags', '')))
    title = normalized(product.get('title', ''))
    def classify(text):
        kids = bool(re.search(r'\b(kids?|children|child|junior|enfants?|garcons?|boys?|girls?|filles?|bebe|baby)\b', text))
        unisex = bool(re.search(r'\b(unisex|unisexe|mixte)\b', text))
        if unisex:
            return 'unisex_kids' if kids else 'unisex_adult'
        if re.search(r'\b(girls?|filles?)\b', text): return 'girls'
        if re.search(r'\b(boys?|garcons?)\b', text): return 'boys'
        if kids: return 'kids'
        if re.search(r'\b(womens?|women|ladies|female|femmes?|femme)\b', text): return 'women'
        if re.search(r'\b(mens?|men|male|hommes?)\b', text): return 'men'
        return None
    return classify(metadata) or classify(title) or 'other'


class DescriptionText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts, self.hidden = [], 0
    def handle_starttag(self, tag, attrs):
        if tag in {'script', 'style', 'iframe'}: self.hidden += 1
        elif tag in {'br', 'p', 'div', 'li', 'h1', 'h2', 'h3'} and not self.hidden: self.parts.append('\n')
    def handle_endtag(self, tag):
        if tag in {'script', 'style', 'iframe'}: self.hidden = max(0, self.hidden - 1)
    def handle_data(self, data):
        if not self.hidden: self.parts.append(data)


def description_text(html):
    parser = DescriptionText()
    parser.feed(str(html or ''))
    return '\n'.join(line.strip() for line in ''.join(parser.parts).splitlines() if line.strip())[:20000]


def paginate(read, store, resource, params=None):
    from urllib.parse import urlencode
    result, since = [], 0
    while True:
        page = read(store, f'/{resource}.json?' + urlencode({'limit': 250, 'since_id': since, **(params or {})})).get(resource)
        if not isinstance(page, list): raise ValueError(f'Missing {resource} response')
        result.extend(page)
        if len(page) < 250: break
        next_id = max(int(item['id']) for item in page)
        if next_id <= since: raise ValueError('Invalid Shopify pagination')
        since = next_id
    return result


def collection_memberships(read, store, settings):
    # A failed membership lookup must stop pricing, not silently apply a cheaper rule.
    ids = {rule['collection_id'] for rule in settings['rules'] if rule['store'] == store}
    return {cid: {str(p['id']) for p in paginate(read, store, 'products', {'collection_id': cid, 'fields': 'id'})} for cid in ids}


def discount_for(product_id, store, settings, memberships):
    percent = settings['discount_percent']
    for rule in settings['rules']:
        if rule['store'] == store and str(product_id) in memberships.get(rule['collection_id'], set()):
            percent = rule['discount_percent']
    return Decimal(str(percent))


def variant_cost(variant, percent):
    price = Decimal(str(variant.get('price') or 0))
    if not price.is_finite() or price <= 0: return None
    return int((price * (100 - percent)).quantize(Decimal('1'), rounding=ROUND_HALF_UP))


def present_product(product, store, currency, percent):
    options = product.get('options') or []
    color_index = next((int(o.get('position', i + 1)) for i, o in enumerate(options) if normalized(o.get('name')) in {'color', 'colour', 'couleur', 'couleurs', 'لون'}), None)
    size_index = next((int(o.get('position', i + 1)) for i, o in enumerate(options) if normalized(o.get('name')) in {'size', 'sizes', 'taille', 'pointure', 'المقاس'}), None)
    images = {str(i.get('id')): i.get('src') for i in product.get('images', []) if i.get('src')}
    variants = []
    for variant in product.get('variants', []):
        cost = variant_cost(variant, percent)
        tracked = bool(variant.get('inventory_management'))
        stock = max(0, int(variant.get('inventory_quantity') or 0))
        # Zero stock is shown unavailable even where Shopify permits overselling.
        available = stock > 0 if tracked else True
        variants.append({'id': str(variant['id']), 'title': variant.get('title', 'Default'),
            'color': variant.get(f'option{color_index}', '') if color_index else '',
            'size': variant.get(f'option{size_index}', '') if size_index else '',
            'options': [variant.get(f'option{i}', '') for i in range(1, 4)],
            'image': images.get(str(variant.get('image_id'))),
            'price': str(variant.get('price') or '0'), 'unit_cost': cost / 100 if cost is not None else None,
            'inventory_quantity': stock if tracked else None, 'available': available and cost is not None})
    return {'id': str(product['id']), 'store': store, 'currency': currency, 'title': product['title'],
        'vendor': product.get('vendor', ''), 'image': next(iter(images.values()), None), 'images': list(images.values()),
        'description': description_text(product.get('body_html')), 'category': product_category(product),
        'created_at': product.get('created_at') or '', 'discount_percent': float(percent),
        'inventory_quantity': sum(v['inventory_quantity'] or 0 for v in variants),
        'inventory_tracked': all(v['inventory_quantity'] is not None for v in variants), 'variants': variants}
