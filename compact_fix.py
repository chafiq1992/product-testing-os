import pathlib
f = pathlib.Path(r'c:/chafiq pc/product-testing-os/frontend/app/ads-management/page.tsx')
c = f.read_text(encoding='utf-8')
c = c.replace('className="px-3 py-2', 'className="px-1.5 py-0.5')
c = c.replace('w-20 h-20', 'w-10 h-10')
c = c.replace('colSpan={17}', 'colSpan={18}')
f.write_text(c, encoding='utf-8')
print('Done - replacements applied')
