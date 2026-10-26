"""Customer-safe adapters for existing merchant catalogs and order pipelines."""
from __future__ import annotations

import asyncio
import json
import threading
import time
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from uuid import UUID, uuid5, NAMESPACE_URL

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select
from app import db

_ORDER_CACHE = {}
_ORDER_CACHE_LOCK = threading.Lock()


def fail(message, status=422):
    raise HTTPException(status, message)


def resolve_merchant(kind, account_id, locator=None):
    from app import main
    if kind == 'vendor':
        with db.SessionLocal() as session:
            rows=session.scalars(select(db.AppSetting).where(db.AppSetting.store == main.WHOLESALE_STORE, db.AppSetting.key.like('wholesale_vendor:%'))).all()
        for row in rows:
            value=json.loads(row.value or '{}')
            value=main._wholesale_ensure_account_identity(value)
            if str(value.get('account_id')) != str(account_id):
                continue
            vid=str(value.get('id') or value.get('username') or '').lower()
            if not vid or locator and str(locator).lower() != vid:
                continue
            return {'kind':'vendor','account_id':str(account_id),'locator':vid,'vendor_id':vid,'vendor':value,
                'name':value.get('name') or vid,'account_type':value.get('account_type') or 'vendor',
                'chat_id':value.get('chat_id') or vid,'avatar':value.get('profile_image') or '', 'requires_delivery':False}
    elif kind == 'seller':
        from app import affiliates
        with db.SessionLocal() as session:
            seller=session.get(affiliates.Seller,str(account_id))
            if seller and seller.status == 'approved':
                value=affiliates._public_seller(seller)
                return {'kind':'seller','account_id':seller.id,'locator':seller.id,'seller':value,'name':seller.name,
                    'account_type':'seller','chat_id':'seller:'+seller.id,'avatar':'','requires_delivery':True}
    fail('Merchant is no longer available.',404)


def list_merchants():
    from app import main,affiliates
    candidates=[]
    with db.SessionLocal() as session:
        vendors=session.scalars(select(db.AppSetting).where(db.AppSetting.store == main.WHOLESALE_STORE,db.AppSetting.key.like('wholesale_vendor:%'))).all()
        sellers=session.scalars(select(affiliates.Seller).where(affiliates.Seller.status=='approved')).all()
        for row in vendors:
            value=json.loads(row.value or '{}')
            if not value.get('id'):
                continue
            # Backfill existing account lifetimes using the same login helper.
            value=main._wholesale_ensure_account_identity(value)
            candidates.append(resolve_merchant('vendor',value['account_id'],value['id']))
        for seller in sellers:
            candidates.append(resolve_merchant('seller',seller.id))
    return candidates


def _born(value):
    try:
        parsed=datetime.fromisoformat(str(value or '').replace('Z','+00:00'))
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed
    except (ValueError,TypeError):
        return None


def _owns_wholesale(product, merchant):
    from app import main
    vendor=merchant['vendor'];tags=main._wholesale_tags_set(product.get('tags'))
    account_tag=merchant['account_id'].lower().replace('-','')
    lifetimes={tag.split(':',1)[1].replace('-','') for tag in tags if tag.startswith(('merchant_account:','ma:'))}
    if lifetimes:
        return lifetimes=={account_tag}
    owner_tag=main._wholesale_vendor_id_tag(merchant['vendor_id']).lower()
    owner_tags={tag for tag in tags if tag.startswith('vendor_id:')}
    if owner_tags and owner_tags!={owner_tag}:
        return False
    try:
        legacy=UUID(merchant['account_id']).version==5
    except ValueError:
        return False
    created,account_created=_born(product.get('created_at')),_born(vendor.get('created_at'))
    within_lifetime=bool(created and account_created and created>=account_created)
    if owner_tags:
        return legacy or within_lifetime
    # Older products used display-name tags. Only accept a unique current name,
    # and never inherit a product predating a new account lifetime.
    name=str(vendor.get('name') or '').strip().casefold()
    if not name or str(product.get('vendor') or '').strip().casefold()!=name or main._wholesale_vendor_name_tag(vendor.get('name')).lower() not in tags:
        return False
    with db.SessionLocal() as session:
        rows=session.scalars(select(db.AppSetting).where(db.AppSetting.store==main.WHOLESALE_STORE,db.AppSetting.key.like('wholesale_vendor:%'))).all()
    owners=[json.loads(row.value or '{}') for row in rows if str(json.loads(row.value or '{}').get('name') or '').strip().casefold()==name]
    return len(owners)==1 and (legacy or within_lifetime)


def _amount(value):
    result=Decimal(str(value or 0))
    if not result.is_finite() or result<0:
        fail('The merchant has an invalid product price.')
    return result.quantize(Decimal('0.01'),rounding=ROUND_HALF_UP)


def _public_product(product, *, store=None, currency='MAD'):
    weighted=product.get('unit_type')=='weight'
    group=str(product.get('section') or product.get('product_type') or product.get('category') or 'Products')
    image=product.get('image_url') or product.get('image') or (product.get('images') or [{}])[0]
    if isinstance(image,dict): image=image.get('src')
    pid=str(product['id']);public_id=f'{store}:{pid}' if store else pid
    variants=[]
    for v in product.get('variants') or []:
        if v.get('available') is False:
            stock=0
        else:
            stock=v.get('inventory_available',v.get('inventory_quantity'))
            stock=100 if stock is None else max(0,float(stock))
        price=_amount(v.get('price'))
        if price<=0:continue
        # Public seller pricing must be viable; never return its private cost.
        if store and v.get('unit_cost') is not None and price<=_amount(v['unit_cost']):continue
        variants.append({'id':f'{store}:{v["id"]}' if store else str(v['id']),'product_id':public_id,
            'title':v.get('title') or 'Unit','price':str(price),'available':stock,
            'stock_grams':int(v.get('stock_grams') or product.get('stock_grams') or 0) if weighted else 0,
            'unit_type':'weight' if weighted else 'unit','sku':v.get('sku') or product.get('short_code') or ''})
    if not variants:return None
    images=[]
    for source in product.get('images') or []:
        src=source.get('src') if isinstance(source,dict) else source
        if src:images.append({'src':str(src)})
    if not images and image:images=[{'src':str(image)}]
    return {'id':public_id,'title':product.get('title') or product.get('name') or 'Product',
        'image':image or '', 'image_url':image or '', 'images':images,'collection_ids':[group],
        'product_type':group,'unit_type':'weight' if weighted else 'unit','short_code':product.get('short_code') or '',
        'stock_grams':int(product.get('stock_grams') or 0),'price_min':str(min(Decimal(v['price']) for v in variants)),
        'price_max':str(max(Decimal(v['price']) for v in variants)),'currency':currency,
        'fulfillment_group':store or '', 'variants':variants}


def _wholesale_products(merchant):
    """Follow store-scoped cursors; never silently truncate a merchant catalog."""
    from urllib.parse import urlencode
    from app import main
    from app.integrations.shopify_client import _rest_get_store_raw_once, _parse_link_rel
    params={'vendor':merchant['vendor']['name'],'limit':250,
        'fields':'id,title,vendor,product_type,status,tags,variants,images,created_at'}
    products=[];seen=set()
    for _ in range(40):
        response=_rest_get_store_raw_once(main.WHOLESALE_STORE,'/products.json?'+urlencode(params),timeout=12)
        products.extend(response.json().get('products') or [])
        cursor=_parse_link_rel(response.headers.get('Link'), 'next')
        if not cursor:return products
        if cursor in seen:fail('The merchant catalog could not be refreshed. Try again shortly.',503)
        seen.add(cursor);params={'limit':250,'page_info':cursor}
    fail('The merchant catalog is too large to load. Contact the merchant.',503)


def catalog(merchant):
    if merchant['account_type']=='grocery':
        from app import grocery
        raw=grocery._products(merchant['vendor_id'],merchant['vendor'])
        products=[p for p in (_public_product(row) for row in raw) if p]
        extra={'currency':'MAD','delivery_fee':'0.00','delivery_cities':[]}
    elif merchant['kind']=='seller':
        from app import affiliates
        data=affiliates.catalog(merchant['seller']['access'])
        if data.get('warnings'):
            fail('The merchant catalog could not be refreshed. Try again shortly.',503)
        products=[p for p in (_public_product(row,store=row['store'],currency=row.get('currency') or 'MAD') for row in data['products']) if p]
        fees={str(k):str(_amount(v)) for k,v in (data['pricing'].get('delivery_fees') or {}).items()}
        cities=affiliates.delivery_cities()
        extra={'currency':products[0]['currency'] if products else 'MAD','delivery_fee':fees.get(products[0]['currency'] if products else 'MAD','0.00'),
            'delivery_fees':fees,'delivery_cities':[{'id':str(c['id']),'name':c['name']} for c in cities]}
    else:
        from app import main
        raw=_wholesale_products(merchant)
        raw=[p for p in raw if _owns_wholesale(p,merchant) and p.get('status','active')=='active']
        raw=main._wholesale_enrich_products_inventory(raw)
        products=[p for p in (_public_product(row) for row in raw) if p]
        extra={'currency':'MAD','delivery_fee':'0.00','delivery_cities':[]}
    groups=sorted({g for p in products for g in p['collection_ids']},key=str.casefold)
    return {'collections':[{'id':g,'title':g} for g in groups],'products':products,**extra}


def _lines(merchant,payload):
    snapshot=catalog(merchant)
    by_variant={v['id']:(p,v) for p in snapshot['products'] for v in p['variants']}
    selected=[];quantities={}
    for line in payload['line_items']:
        variant_id=str(line.get('variant_id') or line.get('product_id') or '')
        pair=by_variant.get(variant_id)
        if not pair:fail('The selected product is not available from this merchant.',404)
        p,v=pair
        if line.get('product_id') is not None and str(line['product_id'])!=p['id']:fail('The product and variant do not match.')
        qty=line.get('quantity')
        if isinstance(qty,bool) or not isinstance(qty,int) or qty<1 or qty>100 or line.get('grams'):
            fail('Choose a whole-item quantity between 1 and 100.')
        quantities[variant_id]=quantities.get(variant_id,0)+qty
        if quantities[variant_id]>v['available']:fail('There is not enough stock for this order.',422)
        selected.append((p,v,qty))
    if not selected:fail('Add at least one product.')
    return snapshot,selected


def place_order(merchant,payload,customer):
    from app import main
    snapshot,lines=_lines(merchant,payload)
    name=str(payload.get('customer_name') or customer.get('name') or 'Customer').strip()
    phone=customer['phone'];address=payload.get('address') or {}
    subtotal=sum((_amount(v['price'])*quantity for _,v,quantity in lines),Decimal(0))
    if merchant['kind']=='seller':
        from app import affiliates
        groups={p['fulfillment_group'] for p,_,_ in lines};currencies={p['currency'] for p,_,_ in lines}
        if len(groups)!=1 or len(currencies)!=1:fail('These products need separate orders. Finish your current cart first.')
        if len(name)<2 or len(str(address.get('address1') or '').strip())<3 or not address.get('city'):
            fail('Enter your name, delivery address and city.')
        store=next(iter(groups));currency=next(iter(currencies));fee=_amount(snapshot.get('delivery_fees',{}).get(currency,snapshot['delivery_fee']))
        _check_total(payload,subtotal+fee)
        try:
            request=affiliates.NewOrder(request_id='portal-'+str(uuid5(NAMESPACE_URL,customer['id']+':'+str(payload['request_id']))),store=store,
                customer_name=name,customer_phone=phone,address=address['address1'],city=address['city'],country=address.get('country') or 'MA',
                note=str(payload.get('note') or '')[:800],items=[{'product_id':p['id'].split(':',1)[1],'variant_id':v['id'].split(':',1)[1],
                    'quantity':q,'sale_price':v['price']} for p,v,q in lines])
        except ValidationError:
            fail('Use a name up to 120 characters, an address up to 250 characters, and at most 50 variants per seller order.')
        request._customer_portal=True
        result=affiliates.create_order(request,seller=merchant['seller'])
        data=result.get('data') or {}
        if data.get('state')!='created' or not data.get('id'):fail('The order needs merchant review before another submission.',409)
        total=_amount(data.get('total'));expected=subtotal+fee
        if total!=expected:fail('The order total needs merchant review before another submission.',409)
        order_id=str(data['id']);status=data.get('status') or 'pending'
    else:
        fee=Decimal(0);currency=snapshot['currency']
        _check_total(payload,subtotal)
        request=main.WholesaleOrderCreate(customer_name=name,customer_phone=phone,
            customer_address1=address.get('address1') or 'NA',customer_city=address.get('city') or 'Casablanca',
            customer_province=address.get('province') or 'Casablanca-Settat',customer_zip=address.get('zip') or '20000',customer_country=address.get('country') or 'MA',
            line_items=[{'variant_id':int(v['id']),'quantity':q} for p,v,q in lines],
            note=('Customer portal request '+str(payload['request_id'])+' · '+str(payload.get('note') or ''))[:1000])
        request._portal_prices={int(v['id']):v['price'] for _,v,_ in lines}
        result=asyncio.run(main.api_wholesale_create_order(merchant['vendor_id'],request))
        data=result.get('data') or {}
        if result.get('error') or not data.get('id'):fail('The order could not be confirmed. The merchant must check this request before another submission.',409)
        total=_amount(data.get('total_price'));expected=subtotal
        if total!=expected:fail('The order total needs merchant review before another submission.',409)
        order_id=str(data['id']);status='new'
    return {'data':{'id':order_id,'name':data.get('name') or '#'+order_id,'total_price':str(total),'delivery_fee':str(fee),
        'currency':currency,'financial_status':'pending','order_status':status,'customer_name':name,'customer_phone':phone,
        'line_items':[{'product_id':p['id'],'variant_id':v['id'],'title':p['title'],'variant_title':v['title'],
            'quantity':q,'price':v['price'],'line_total':str(_amount(v['price'])*q),'image':p['image']} for p,v,q in lines],
        'created_at':data.get('created_at') or datetime.utcnow().isoformat()+'Z'}}


def _check_total(payload,total):
    if payload.get('expected_total') is not None and _amount(payload['expected_total'])!=total:
        raise HTTPException(422,{'error':'price_changed','message':'Prices changed. Refresh your basket before placing the order.'})


def refresh_order(merchant,order_id):
    """Read status only; never return another merchant/customer's raw history."""
    if merchant['account_type']=='grocery':
        from app import grocery
        result=grocery.list_orders(merchant['vendor_id'])['data']['all_orders']
        return next((o for o in result if str(o['id'])==str(order_id)),None)
    if merchant['kind']=='seller':
        from app import affiliates
        with db.SessionLocal() as session:
            row=session.get(affiliates.SellerOrder,str(order_id))
            if row and row.seller_id==merchant['account_id']:
                view=affiliates.order_view(row)
                return {'order_status':view.get('status'),'financial_status':view.get('financial_status'),'total_price':str(view.get('total') or 0)}
        return None
    # One history refresh per merchant, rather than one network call per receipt.
    key=merchant['account_id'];now=time.monotonic()
    with _ORDER_CACHE_LOCK:
        cached=_ORDER_CACHE.get(key)
    if cached and now-cached[0]<15:
        result=cached[1]
    else:
        result=asyncio.run(main_orders(merchant['vendor_id']))
        if result.get('error'):return None
        with _ORDER_CACHE_LOCK:
            if len(_ORDER_CACHE)>256:_ORDER_CACHE.clear()
            _ORDER_CACHE[key]=(now,result)
    return next((o for o in result.get('data',{}).get('all_orders',[]) if str(o['id'])==str(order_id)),None)


async def main_orders(vendor_id):
    from app import main
    return await main.api_wholesale_vendor_orders(vendor_id)
