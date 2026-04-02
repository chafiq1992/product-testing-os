"use client"

import { useState, useEffect, useMemo, useRef } from 'react'
import Link from 'next/link'
import {
  LayoutDashboard, PlusCircle, Package, Camera, Settings, Trash2, Plus, Loader2,
  TrendingUp, Box, DollarSign, Tag as TagIcon, RefreshCw, Image as ImageIcon,
  Filter, ChevronDown, Calendar, Clock, Layers, X, LogOut, User, Eye, EyeOff,
  ShoppingCart, CheckCircle, Minus, Search, Phone, MapPin, ClipboardList, FileText,
  CreditCard, AlertCircle, ChevronRight, Edit3, Users
} from 'lucide-react'

const API = process.env.NEXT_PUBLIC_API_BASE_URL || ''
const SEGMENTS = ['Men', 'Women', 'Kids']
const SEASONS = ['Winter', 'Summer', 'Spring', 'Fall']
type Lang = 'en' | 'ar'
type StockVariantFormRow = {
  from: number
  to: number
  pcsPerCrate: number
  crateQty: number
  sku: string
}

type WholesaleAddressForm = {
  address1: string
  city: string
  province: string
  zip: string
  country: string
}

function createStockVariantRow(): StockVariantFormRow {
  return { from: 20, to: 25, pcsPerCrate: 24, crateQty: 10, sku: '' }
}

function getLocale(lang: Lang) {
  return lang === 'ar' ? 'ar-MA' : 'en-GB'
}

function toNumber(value: number | string | null | undefined) {
  const parsed = typeof value === 'number' ? value : parseFloat(String(value ?? '0'))
  return Number.isFinite(parsed) ? parsed : 0
}

function formatDh(value: number | string | null | undefined, locale = 'en-GB') {
  const amount = toNumber(value)
  return `${amount.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`
}

function buildVariantTitle(group: Pick<StockVariantFormRow, 'from' | 'to' | 'pcsPerCrate'>) {
  const range = `${group.from}-${group.to}`
  return group.pcsPerCrate > 0 ? `${range}*${group.pcsPerCrate}pcs` : range
}

function getVariantCratePrice(unitSalePrice: number, group: Pick<StockVariantFormRow, 'pcsPerCrate'>) {
  return unitSalePrice * Math.max(0, group.pcsPerCrate || 0)
}

function createDefaultWholesaleAddress(): WholesaleAddressForm {
  return { address1: 'NA', city: 'Casablanca', province: 'Casablanca-Settat', zip: '20000', country: 'MA' }
}

function normalizeWholesalePhone(phone: string | null | undefined) {
  let digits = String(phone || '').replace(/\D+/g, '')
  if (!digits) return ''
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.startsWith('212') && digits.length >= 11) return `0${digits.slice(3)}`
  if (digits.length === 9 && ['5', '6', '7'].includes(digits[0])) return `0${digits}`
  return digits
}

const WHOLESALE_COPY = {
  en: {
    brand: 'BulkIndex',
    brandTag: 'Wholesale control center',
    portal: 'Vendor Portal',
    overview: 'Overview',
    inventory: 'Inventory',
    orders: 'Orders',
    customers: 'Customers',
    createOrder: 'Create Order',
    addProduct: 'Add Product',
    home: 'Home',
    stock: 'Stock',
    add: 'Add',
    languageLabel: 'Arabic mode',
    english: 'EN',
    arabic: 'AR',
    welcome: 'Manage your wholesale business with a faster, cleaner workflow.',
    settingsTitle: 'Vendor Settings',
    vendorName: 'Vendor name',
    username: 'Username',
    password: 'Password',
    passwordValue: 'Protected for security',
    passwordNote: 'We do not show the real password here for safety.',
    logout: 'Logout',
    role: 'Vendor',
    overviewTitle: 'Dashboard Overview',
    overviewSub: 'Performance metrics for your products on MMD store.',
    totalProducts: 'Total Products',
    inventoryLevel: 'Inventory Level',
    inventoryLevelSub: 'Total units in stock',
    inventoryValue: 'Inventory Value',
    inventoryValueSub: 'Current market value',
    ordersStat: 'Orders',
    ordersStatSub: 'Loading...',
    unitsSold: 'Units Sold',
    unitsSoldSub: 'Total items ordered',
    inventoryTitle: 'Live Inventory',
    inventorySub: 'Products on the MMD Shopify store assigned to you.',
    searchProducts: 'Search products...',
    allSegments: 'All Segments',
    noProducts: 'No products found.',
    recentProducts: 'Recent Products',
    productsBySegment: 'Products by Segment',
  },
  ar: {
    brand: 'BulkIndex',
    brandTag: 'منصة البيع بالجملة',
    portal: 'فضاء التاجر',
    overview: 'نظرة عامة',
    inventory: 'الستوك',
    orders: 'الطلبات',
    customers: 'الزبناء',
    createOrder: 'دير طلب',
    addProduct: 'زيد منتوج',
    home: 'الرئيسية',
    stock: 'الستوك',
    add: 'زيد',
    languageLabel: 'العربية المغربية',
    english: 'EN',
    arabic: 'AR',
    welcome: 'دبّر خدمتك فالجملة بواجهة سريعة وواضحة ومناسبة للتجار المغاربة.',
    settingsTitle: 'إعدادات التاجر',
    vendorName: 'سمية التاجر',
    username: 'اسم الدخول',
    password: 'كلمة السر',
    passwordValue: 'محمية',
    passwordNote: 'ما كنوريوش كلمة السر الحقيقية هنا حفاظا على الأمان.',
    logout: 'تسجيل الخروج',
    role: 'تاجر',
    overviewTitle: 'نظرة عامة',
    overviewSub: 'أهم الأرقام ديال المنتوجات ديالك فمتجر MMD.',
    totalProducts: 'مجموع المنتوجات',
    inventoryLevel: 'مستوى الستوك',
    inventoryLevelSub: 'مجموع الوحدات فالستوك',
    inventoryValue: 'قيمة الستوك',
    inventoryValueSub: 'القيمة الحالية',
    ordersStat: 'الطلبات',
    ordersStatSub: 'كيتحمّل...',
    unitsSold: 'الوحدات المباعة',
    unitsSoldSub: 'مجموع القطع المطلوبة',
    inventoryTitle: 'الستوك المباشر',
    inventorySub: 'المنتوجات الموجودة فـ Shopify والمرتبطة بيك.',
    searchProducts: 'قلّب على منتوج...',
    allSegments: 'جميع الفئات',
    noProducts: 'ما كاين حتى منتوج.',
    recentProducts: 'آخر المنتوجات',
    productsBySegment: 'المنتوجات حسب الفئة',
  },
} as const
type WholesaleCopy = (typeof WHOLESALE_COPY)[Lang]

const WHOLESALE_TEXT = {
  en: {
    brand: 'BulkIndex',
    brandTag: 'Wholesale control center',
    portal: 'Vendor Portal',
    overview: 'Overview',
    inventory: 'Inventory',
    orders: 'Orders',
    customers: 'Customers',
    createOrder: 'Create Order',
    addProduct: 'Add Product',
    home: 'Home',
    stock: 'Stock',
    add: 'Add',
    languageLabel: 'العربية',
    english: 'EN',
    arabic: 'AR',
    welcome: 'Manage your wholesale business with a faster, cleaner workflow.',
    settingsTitle: 'Vendor Settings',
    vendorName: 'Vendor name',
    username: 'Username',
    password: 'Password',
    passwordValue: 'Protected for security',
    passwordNote: 'We do not show the real password here for safety.',
    logout: 'Logout',
    role: 'Vendor',
    overviewTitle: 'Dashboard Overview',
    overviewSub: 'Performance metrics for your products on MMD store.',
    totalProducts: 'Total Products',
    inventoryLevel: 'Inventory Level',
    inventoryLevelSub: 'Total units in stock',
    inventoryValue: 'Inventory Value',
    inventoryValueSub: 'Current market value',
    ordersStat: 'Orders',
    ordersStatSub: 'Loading...',
    unitsSold: 'Units Sold',
    unitsSoldSub: 'Total items ordered',
    inventoryTitle: 'Live Inventory',
    inventorySub: 'Products on the MMD Shopify store assigned to you.',
    searchProducts: 'Search products...',
    allSegments: 'All Segments',
    noProducts: 'No products found.',
    recentProducts: 'Recent Products',
    productsBySegment: 'Products by Segment',
    revenueLabel: 'revenue',
    productDetail: 'Product Detail',
    status: 'Status',
    price: 'Price',
    loadingPortal: 'Loading portal...',
    loadingProducts: 'Loading products...',
    loginTitle: 'BulkIndex',
    loginSubtitle: 'Wholesale Vendor Portal',
    usernamePlaceholder: 'Enter your username',
    passwordPlaceholder: 'Enter your password',
    invalidCredentials: 'Invalid credentials',
    unexpectedResponse: 'Unexpected response',
    networkError: 'Network error',
    signIn: 'Sign In',
    contactAdmin: 'Contact admin to get your vendor credentials',
    activeStatus: 'Active',
    inactiveStatus: 'Inactive',
    untitled: 'Untitled',
    addProductTitle: 'Add Product',
    addProductSub: 'Upload the image, choose colors, enter financials, and add stock variants. Analysis and catalog data will run in the background.',
    productPhoto: 'Product Photo',
    productPreview: 'Product preview',
    takePhotoOrUpload: 'Take a photo or upload an image of your product',
    generatedAfterCreate: 'Title, description, and analysis will be generated after the product is created.',
    takePhoto: 'Take Photo',
    upload: 'Upload',
    retake: 'Retake',
    uploadingImage: 'Uploading image...',
    imageUploaded: 'Image uploaded. Catalog data will finish in the background after save.',
    uploadFailed: 'Upload failed. Please try again.',
    uploadError: 'Upload error. Please try again.',
    backgroundAnalysisStarts: 'Background analysis starts after save',
    colorsTitle: 'Colors',
    colorsLabel: 'Product Colors',
    colorPlaceholder: 'Enter color name...',
    addColor: 'Add',
    noColorsYet: 'No colors added yet.',
    hiddenCatalogNote: 'Catalog data, title, and description are hidden here and will be generated after the product is submitted.',
    financialsTitle: 'Financials',
    cogPrice: 'Unit Cost Price',
    salePrice: 'Unit Sale Price',
    estimatedProfit: 'Est. Unit Profit',
    stockVariants: 'Stock Variants',
    addRange: 'Add Range',
    sku: 'SKU',
    from: 'From',
    to: 'To',
    qty: 'Crates',
    piecesPerCrate: 'Pcs / Crate',
    cratesLabel: 'crates',
    variantPreview: 'Variant Preview',
    cratePrice: 'Crate Price',
    unitPriceNote: 'The sale price is the unit price. Each variant price is calculated automatically from the pieces per crate.',
    stockVariantNote: 'Each stock variant uses its own SKU, crate count, and pieces per crate.',
    productsTaggedAs: 'Products will be tagged as',
    vendorFieldNote: 'This name will appear as the vendor field on Shopify',
    createProductCta: 'Create Product',
    creatingProduct: 'Creating Product...',
    uploadImageRequired: 'Please upload a product image.',
    colorRequired: 'Please add at least one color.',
    unitSalePriceRequired: 'Please enter the unit sale price.',
    stockVariantRequired: 'Please add at least one stock variant.',
    skuRequired: 'Please enter a SKU for each stock variant.',
    piecesPerCrateRequired: 'Please enter the pieces per crate for each stock variant.',
    crateQuantityRequired: 'Please enter the number of crates for each stock variant.',
    errorPrefix: 'Error',
    saveProductError: 'Error saving product:',
    productCreatedSuccess: 'Product created successfully. Catalog data and analysis will finish in the background.',
    createOrderTitle: 'Create Order',
    createOrderSub: 'Select products by SKU and enter customer details.',
    addProducts: 'Add Products',
    searchByProductOrSku: 'Search by product name or SKU...',
    noProductsFound: 'No products found',
    inStock: 'in stock',
    each: 'per crate',
    orderTotal: 'Order Total',
    customerDetails: 'Customer Details',
    fullName: 'Full Name *',
    phone: 'Phone *',
    addressSummary: 'Address (auto-filled - click to edit)',
    address: 'Address',
    city: 'City',
    province: 'Province',
    zip: 'ZIP',
    placeOrder: 'Place Order',
    itemsLabel: 'items',
    customerNamePhoneRequired: 'Customer name and phone are required',
    addAtLeastOneProduct: 'Add at least one product',
    failedPrefix: 'Failed',
    invoiceImageFailed: 'Failed to generate invoice image. Please try again.',
    downloadInvoice: 'Download Invoice',
    shareInvoice: 'Share Invoice',
    invoice: 'INVOICE',
    invoiceNumber: 'Invoice No.',
    issueDate: 'Issue Date',
    wholesaleVendor: 'Wholesale Vendor',
    customer: 'Customer',
    billFrom: 'Bill from',
    billTo: 'Bill to',
    invoiceDetails: 'Invoice Details',
    date: 'Date',
    time: 'Time',
    confirmed: 'Confirmed',
    itemColumn: 'Item',
    unitPrice: 'Unit Price',
    lineTotal: 'Line Total',
    subtotal: 'Subtotal',
    shipping: 'Shipping',
    free: 'Free',
    total: 'Total',
    thankYou: 'Thank you for your business!',
    newOrder: 'New Order',
    backToOverview: 'Back to Overview',
    ordersTitle: 'Orders',
    totalOrdersLabel: 'total orders',
    searchOrders: 'Search orders, customers, products...',
    allCustomers: 'All Customers',
    unpaidFirst: 'Unpaid First',
    newest: 'Newest',
    oldest: 'Oldest',
    noOrdersFound: 'No orders found',
    adjustSearchOrFilters: 'Try adjusting your search or filters',
    remaining: 'Remaining',
    paymentNote: 'Payment Note',
    updatePayment: 'Update Payment',
    paymentStatus: 'Payment Status',
    unpaid: 'Unpaid',
    partial: 'Partial',
    paid: 'Paid',
    amountPaid: 'Amount Paid (DH)',
    noteOptional: 'Note (optional)',
    anyPaymentNotes: 'Any payment notes...',
    cancel: 'Cancel',
    save: 'Save',
    customersTitle: 'Customers',
    taggedCustomersLabel: 'tagged customers',
    unpaidLabel: 'unpaid',
    searchCustomers: 'Search customers by name or phone...',
    adjustSearch: 'Try adjusting your search',
    notAvailable: 'N/A',
    noPhone: 'No phone',
    ordersCountLabel: 'orders',
    pending: 'Pending',
    selectCustomer: 'Select a customer',
    unpaidTotal: 'Unpaid Total',
    noOrdersForCustomer: 'No orders found for this customer.',
  },
  ar: {
    brand: 'BulkIndex',
    brandTag: 'منصة إدارة البيع بالجملة',
    portal: 'بوابة المورّد',
    overview: 'نظرة عامة',
    inventory: 'المخزون',
    orders: 'الطلبات',
    customers: 'العملاء',
    createOrder: 'إنشاء طلب',
    addProduct: 'إضافة منتج',
    home: 'الرئيسية',
    stock: 'المخزون',
    add: 'إضافة',
    languageLabel: 'العربية',
    english: 'EN',
    arabic: 'AR',
    welcome: 'أدِر أعمال البيع بالجملة بسرعة ووضوح ومن مكان واحد.',
    settingsTitle: 'إعدادات المورّد',
    vendorName: 'اسم المورّد',
    username: 'اسم المستخدم',
    password: 'كلمة المرور',
    passwordValue: 'محمي لأسباب أمنية',
    passwordNote: 'لا نعرض كلمة المرور الفعلية هنا حفاظًا على الأمان.',
    logout: 'تسجيل الخروج',
    role: 'مورّد',
    overviewTitle: 'لوحة المتابعة',
    overviewSub: 'مؤشرات أداء منتجاتك في متجر MMD.',
    totalProducts: 'إجمالي المنتجات',
    inventoryLevel: 'مستوى المخزون',
    inventoryLevelSub: 'إجمالي الوحدات المتاحة',
    inventoryValue: 'قيمة المخزون',
    inventoryValueSub: 'القيمة الحالية للمخزون',
    ordersStat: 'الطلبات',
    ordersStatSub: 'جارٍ التحميل...',
    unitsSold: 'الوحدات المباعة',
    unitsSoldSub: 'إجمالي القطع المطلوبة',
    inventoryTitle: 'المخزون المباشر',
    inventorySub: 'المنتجات المسندة إليك في متجر Shopify الخاص بـ MMD.',
    searchProducts: 'ابحث عن المنتجات...',
    allSegments: 'جميع الفئات',
    noProducts: 'لم يتم العثور على منتجات.',
    recentProducts: 'أحدث المنتجات',
    productsBySegment: 'المنتجات حسب الفئة',
    revenueLabel: 'إيراد',
    productDetail: 'تفاصيل المنتج',
    status: 'الحالة',
    price: 'السعر',
    loadingPortal: 'جارٍ تحميل البوابة...',
    loadingProducts: 'جارٍ تحميل المنتجات...',
    loginTitle: 'BulkIndex',
    loginSubtitle: 'بوابة مورّدي الجملة',
    usernamePlaceholder: 'أدخل اسم المستخدم',
    passwordPlaceholder: 'أدخل كلمة المرور',
    invalidCredentials: 'بيانات الدخول غير صحيحة',
    unexpectedResponse: 'تم استلام استجابة غير متوقعة',
    networkError: 'حدث خطأ في الاتصال',
    signIn: 'تسجيل الدخول',
    contactAdmin: 'تواصل مع المسؤول للحصول على بيانات دخول المورّد',
    activeStatus: 'نشط',
    inactiveStatus: 'غير نشط',
    untitled: 'بدون عنوان',
    addProductTitle: 'إضافة منتج',
    addProductSub: 'ارفع الصورة، واختر الألوان، وأدخل البيانات المالية، ثم أضف تنويعات المخزون. سيعمل التحليل وبيانات الكتالوج في الخلفية.',
    productPhoto: 'صورة المنتج',
    productPreview: 'معاينة المنتج',
    takePhotoOrUpload: 'التقط صورة أو ارفع صورة للمنتج',
    generatedAfterCreate: 'سيتم إنشاء العنوان والوصف والتحليل بعد إنشاء المنتج.',
    takePhoto: 'التقاط صورة',
    upload: 'رفع صورة',
    retake: 'إعادة الالتقاط',
    uploadingImage: 'جارٍ رفع الصورة...',
    imageUploaded: 'تم رفع الصورة. ستكتمل بيانات الكتالوج في الخلفية بعد الحفظ.',
    uploadFailed: 'فشل رفع الصورة. يرجى المحاولة مرة أخرى.',
    uploadError: 'حدث خطأ أثناء رفع الصورة. يرجى المحاولة مرة أخرى.',
    backgroundAnalysisStarts: 'سيبدأ التحليل في الخلفية بعد الحفظ',
    colorsTitle: 'الألوان',
    colorsLabel: 'ألوان المنتج',
    colorPlaceholder: 'أدخل اسم اللون...',
    addColor: 'إضافة',
    noColorsYet: 'لم تتم إضافة أي ألوان بعد.',
    hiddenCatalogNote: 'بيانات الكتالوج والعنوان والوصف مخفية هنا، وسيتم إنشاؤها بعد إرسال المنتج.',
    financialsTitle: 'البيانات المالية',
    cogPrice: 'سعر التكلفة',
    salePrice: 'سعر البيع',
    estimatedProfit: 'صافي الربح المتوقع',
    stockVariants: 'تنويعات المخزون',
    addRange: 'إضافة نطاق',
    sku: 'رمز SKU',
    from: 'من',
    to: 'إلى',
    qty: 'الكمية',
    stockVariantNote: 'يستخدم كل تنويع من المخزون رمز SKU وكمية خاصين به.',
    productsTaggedAs: 'سيتم وسم المنتجات باسم',
    vendorFieldNote: 'سيظهر هذا الاسم كحقل المورّد في Shopify',
    createProductCta: 'إنشاء المنتج',
    creatingProduct: 'جارٍ إنشاء المنتج...',
    uploadImageRequired: 'يرجى رفع صورة للمنتج.',
    colorRequired: 'يرجى إضافة لون واحد على الأقل.',
    stockVariantRequired: 'يرجى إضافة تنويع مخزون واحد على الأقل.',
    skuRequired: 'يرجى إدخال رمز SKU لكل تنويع مخزون.',
    errorPrefix: 'خطأ',
    saveProductError: 'حدث خطأ أثناء حفظ المنتج:',
    productCreatedSuccess: 'تم إنشاء المنتج بنجاح. سيكتمل إنشاء بيانات الكتالوج والتحليل في الخلفية.',
    createOrderTitle: 'إنشاء طلب',
    createOrderSub: 'اختر المنتجات حسب SKU ثم أدخل بيانات العميل.',
    addProducts: 'إضافة منتجات',
    searchByProductOrSku: 'ابحث باسم المنتج أو رمز SKU...',
    noProductsFound: 'لم يتم العثور على منتجات',
    inStock: 'في المخزون',
    each: 'للوحدة',
    orderTotal: 'إجمالي الطلب',
    customerDetails: 'بيانات العميل',
    fullName: 'الاسم الكامل *',
    phone: 'رقم الهاتف *',
    addressSummary: 'العنوان (معبأ تلقائيًا، اضغط للتعديل)',
    address: 'العنوان',
    city: 'المدينة',
    province: 'الجهة',
    zip: 'الرمز البريدي',
    placeOrder: 'تأكيد الطلب',
    itemsLabel: 'أصناف',
    customerNamePhoneRequired: 'اسم العميل ورقم الهاتف مطلوبان.',
    addAtLeastOneProduct: 'أضف منتجًا واحدًا على الأقل.',
    failedPrefix: 'تعذر التنفيذ',
    invoiceImageFailed: 'تعذر إنشاء صورة الفاتورة. يرجى المحاولة مرة أخرى.',
    downloadInvoice: 'تنزيل الفاتورة',
    shareInvoice: 'مشاركة الفاتورة',
    invoice: 'فاتورة',
    wholesaleVendor: 'مورّد الجملة',
    customer: 'العميل',
    invoiceDetails: 'تفاصيل الفاتورة',
    date: 'التاريخ',
    time: 'الوقت',
    confirmed: 'مؤكد',
    itemColumn: 'الصنف',
    subtotal: 'المجموع الفرعي',
    shipping: 'الشحن',
    free: 'مجاني',
    total: 'الإجمالي',
    thankYou: 'شكرًا لتعاملكم معنا',
    newOrder: 'طلب جديد',
    backToOverview: 'العودة إلى الرئيسية',
    ordersTitle: 'الطلبات',
    totalOrdersLabel: 'إجمالي الطلبات',
    searchOrders: 'ابحث في الطلبات أو العملاء أو المنتجات...',
    allCustomers: 'جميع العملاء',
    unpaidFirst: 'غير المدفوع أولًا',
    newest: 'الأحدث',
    oldest: 'الأقدم',
    noOrdersFound: 'لم يتم العثور على طلبات',
    adjustSearchOrFilters: 'جرّب تعديل البحث أو عوامل التصفية',
    remaining: 'المتبقي',
    paymentNote: 'ملاحظة الدفع',
    updatePayment: 'تحديث الدفع',
    paymentStatus: 'حالة الدفع',
    unpaid: 'غير مدفوع',
    partial: 'مدفوع جزئيًا',
    paid: 'مدفوع',
    amountPaid: 'المبلغ المدفوع (MAD)',
    noteOptional: 'ملاحظة (اختياري)',
    anyPaymentNotes: 'أي ملاحظات حول الدفع...',
    cancel: 'إلغاء',
    save: 'حفظ',
    customersTitle: 'العملاء',
    taggedCustomersLabel: 'عملاء مسجّلون',
    unpaidLabel: 'غير مدفوع',
    searchCustomers: 'ابحث عن العملاء بالاسم أو رقم الهاتف...',
    adjustSearch: 'جرّب تعديل البحث',
    notAvailable: 'غير متوفر',
    noPhone: 'لا يوجد رقم هاتف',
    ordersCountLabel: 'طلبات',
    pending: 'معلّق',
    selectCustomer: 'اختر عميلًا',
    unpaidTotal: 'إجمالي غير المدفوع',
    noOrdersForCustomer: 'لا توجد طلبات لهذا العميل.',
  },
} as const

type AppCopy = typeof WHOLESALE_TEXT.en

const ARABIC_TEXT_OVERRIDES = {
  brandTag: 'منصة إدارة البيع بالجملة',
  portal: 'بوابة المورّد',
  overview: 'نظرة عامة',
  inventory: 'المخزون',
  orders: 'الطلبات',
  customers: 'العملاء',
  createOrder: 'إنشاء طلب',
  addProduct: 'إضافة منتج',
  home: 'الرئيسية',
  stock: 'المخزون',
  add: 'إضافة',
  languageLabel: 'العربية',
  welcome: 'أدِر أعمال البيع بالجملة بسرعة ووضوح ومن مكان واحد.',
  settingsTitle: 'إعدادات المورّد',
  vendorName: 'اسم المورّد',
  username: 'اسم المستخدم',
  password: 'كلمة المرور',
  passwordValue: 'محمي لأسباب أمنية',
  passwordNote: 'لا نعرض كلمة المرور الفعلية هنا حفاظًا على الأمان.',
  logout: 'تسجيل الخروج',
  role: 'مورّد',
  overviewTitle: 'لوحة المتابعة',
  overviewSub: 'مؤشرات أداء منتجاتك في متجر MMD.',
  totalProducts: 'إجمالي المنتجات',
  inventoryLevel: 'مستوى المخزون',
  inventoryLevelSub: 'إجمالي الوحدات المتاحة',
  inventoryValue: 'قيمة المخزون',
  inventoryValueSub: 'القيمة الحالية للمخزون',
  ordersStat: 'الطلبات',
  ordersStatSub: 'جارٍ التحميل...',
  unitsSold: 'الوحدات المباعة',
  unitsSoldSub: 'إجمالي القطع المطلوبة',
  inventoryTitle: 'المخزون المباشر',
  inventorySub: 'المنتجات المسندة إليك في متجر Shopify الخاص بـ MMD.',
  searchProducts: 'ابحث عن المنتجات...',
  allSegments: 'جميع الفئات',
  noProducts: 'لم يتم العثور على منتجات.',
  recentProducts: 'أحدث المنتجات',
  productsBySegment: 'المنتجات حسب الفئة',
  revenueLabel: 'إيراد',
  productDetail: 'تفاصيل المنتج',
  status: 'الحالة',
  price: 'السعر',
  loadingPortal: 'جارٍ تحميل البوابة...',
  loadingProducts: 'جارٍ تحميل المنتجات...',
  loginSubtitle: 'بوابة مورّدي الجملة',
  usernamePlaceholder: 'أدخل اسم المستخدم',
  passwordPlaceholder: 'أدخل كلمة المرور',
  invalidCredentials: 'بيانات الدخول غير صحيحة',
  unexpectedResponse: 'تم استلام استجابة غير متوقعة',
  networkError: 'حدث خطأ في الاتصال',
  signIn: 'تسجيل الدخول',
  contactAdmin: 'تواصل مع المسؤول للحصول على بيانات دخول المورّد',
  activeStatus: 'نشط',
  inactiveStatus: 'غير نشط',
  untitled: 'بدون عنوان',
  addProductTitle: 'إضافة منتج',
  addProductSub: 'ارفع الصورة، واختر الألوان، وأدخل البيانات المالية، ثم أضف تنويعات المخزون. سيعمل التحليل وبيانات الكتالوج في الخلفية.',
  productPhoto: 'صورة المنتج',
  productPreview: 'معاينة المنتج',
  takePhotoOrUpload: 'التقط صورة أو ارفع صورة للمنتج',
  generatedAfterCreate: 'سيتم إنشاء العنوان والوصف والتحليل بعد إنشاء المنتج.',
  takePhoto: 'التقاط صورة',
  upload: 'رفع صورة',
  retake: 'إعادة الالتقاط',
  uploadingImage: 'جارٍ رفع الصورة...',
  imageUploaded: 'تم رفع الصورة. ستكتمل بيانات الكتالوج في الخلفية بعد الحفظ.',
  uploadFailed: 'فشل رفع الصورة. يُرجى المحاولة مرة أخرى.',
  uploadError: 'حدث خطأ أثناء رفع الصورة. يُرجى المحاولة مرة أخرى.',
  backgroundAnalysisStarts: 'سيبدأ التحليل في الخلفية بعد الحفظ',
  colorsTitle: 'الألوان',
  colorsLabel: 'ألوان المنتج',
  colorPlaceholder: 'أدخل اسم اللون...',
  addColor: 'إضافة',
  noColorsYet: 'لم تتم إضافة أي ألوان بعد.',
  hiddenCatalogNote: 'بيانات الكتالوج والعنوان والوصف مخفية هنا، وسيتم إنشاؤها بعد إرسال المنتج.',
  financialsTitle: 'البيانات المالية',
  cogPrice: 'سعر تكلفة الوحدة',
  salePrice: 'سعر بيع الوحدة',
  estimatedProfit: 'الربح المتوقع للوحدة',
  stockVariants: 'تنويعات المخزون',
  addRange: 'إضافة نطاق',
  sku: 'رمز SKU',
  from: 'من',
  to: 'إلى',
  qty: 'عدد الصناديق',
  piecesPerCrate: 'القطع في الصندوق',
  cratesLabel: 'صناديق',
  variantPreview: 'معاينة التنويع',
  cratePrice: 'سعر الصندوق',
  unitPriceNote: 'سعر البيع الذي تدخله هو سعر الوحدة. يتم احتساب سعر كل تنويع تلقائيًا بحسب عدد القطع في الصندوق.',
  stockVariantNote: 'لكل تنويع رمز SKU مستقل، وعدد قطع في الصندوق، وعدد صناديق خاص به.',
  productsTaggedAs: 'سيتم وسم المنتجات باسم',
  vendorFieldNote: 'سيظهر هذا الاسم كحقل المورّد في Shopify',
  createProductCta: 'إنشاء المنتج',
  creatingProduct: 'جارٍ إنشاء المنتج...',
  uploadImageRequired: 'يرجى رفع صورة للمنتج.',
  colorRequired: 'يرجى إضافة لون واحد على الأقل.',
  unitSalePriceRequired: 'يرجى إدخال سعر بيع الوحدة.',
  stockVariantRequired: 'يرجى إضافة تنويع مخزون واحد على الأقل.',
  skuRequired: 'يرجى إدخال رمز SKU لكل تنويع مخزون.',
  piecesPerCrateRequired: 'يرجى إدخال عدد القطع في الصندوق لكل تنويع.',
  crateQuantityRequired: 'يرجى إدخال عدد الصناديق لكل تنويع.',
  errorPrefix: 'خطأ',
  saveProductError: 'حدث خطأ أثناء حفظ المنتج:',
  productCreatedSuccess: 'تم إنشاء المنتج بنجاح. سيكتمل إنشاء بيانات الكتالوج والتحليل في الخلفية.',
  createOrderTitle: 'إنشاء طلب',
  createOrderSub: 'اختر المنتجات حسب SKU ثم أدخل بيانات العميل.',
  addProducts: 'إضافة منتجات',
  searchByProductOrSku: 'ابحث باسم المنتج أو رمز SKU...',
  noProductsFound: 'لم يتم العثور على منتجات',
  inStock: 'في المخزون',
  each: 'للصندوق',
  orderTotal: 'إجمالي الطلب',
  customerDetails: 'بيانات العميل',
  fullName: 'الاسم الكامل *',
  phone: 'رقم الهاتف *',
  addressSummary: 'العنوان (معبأ تلقائيًا، اضغط للتعديل)',
  address: 'العنوان',
  city: 'المدينة',
  province: 'الجهة',
  zip: 'الرمز البريدي',
  placeOrder: 'تأكيد الطلب',
  itemsLabel: 'أصناف',
  customerNamePhoneRequired: 'اسم العميل ورقم الهاتف مطلوبان.',
  addAtLeastOneProduct: 'أضف منتجًا واحدًا على الأقل.',
  failedPrefix: 'تعذر التنفيذ',
  invoiceImageFailed: 'تعذر إنشاء صورة الفاتورة. يُرجى المحاولة مرة أخرى.',
  downloadInvoice: 'تنزيل الفاتورة',
  shareInvoice: 'مشاركة الفاتورة',
  invoice: 'فاتورة',
  invoiceNumber: 'رقم الفاتورة',
  issueDate: 'تاريخ الإصدار',
  wholesaleVendor: 'مورّد الجملة',
  customer: 'العميل',
  billFrom: 'صادرة من',
  billTo: 'صادرة إلى',
  invoiceDetails: 'تفاصيل الفاتورة',
  date: 'التاريخ',
  time: 'الوقت',
  confirmed: 'مؤكد',
  itemColumn: 'الصنف',
  unitPrice: 'سعر الوحدة',
  lineTotal: 'إجمالي السطر',
  subtotal: 'المجموع الفرعي',
  shipping: 'الشحن',
  free: 'مجاني',
  total: 'الإجمالي',
  thankYou: 'شكرًا لتعاملكم معنا',
  newOrder: 'طلب جديد',
  backToOverview: 'العودة إلى الرئيسية',
  totalOrdersLabel: 'إجمالي الطلبات',
  searchOrders: 'ابحث في الطلبات أو العملاء أو المنتجات...',
  allCustomers: 'جميع العملاء',
  unpaidFirst: 'غير المدفوع أولًا',
  newest: 'الأحدث',
  oldest: 'الأقدم',
  noOrdersFound: 'لم يتم العثور على طلبات',
  adjustSearchOrFilters: 'جرّب تعديل البحث أو عوامل التصفية',
  remaining: 'المتبقي',
  paymentNote: 'ملاحظة الدفع',
  updatePayment: 'تحديث الدفع',
  paymentStatus: 'حالة الدفع',
  unpaid: 'غير مدفوع',
  partial: 'مدفوع جزئيًا',
  paid: 'مدفوع',
  amountPaid: 'المبلغ المدفوع (DH)',
  noteOptional: 'ملاحظة (اختياري)',
  anyPaymentNotes: 'أي ملاحظات حول الدفع...',
  cancel: 'إلغاء',
  save: 'حفظ',
  taggedCustomersLabel: 'عملاء مسجّلون',
  unpaidLabel: 'غير مدفوع',
  searchCustomers: 'ابحث عن العملاء بالاسم أو رقم الهاتف...',
  adjustSearch: 'جرّب تعديل البحث',
  notAvailable: 'غير متوفر',
  noPhone: 'لا يوجد رقم هاتف',
  ordersCountLabel: 'طلبات',
  pending: 'معلّق',
  selectCustomer: 'اختر عميلًا',
  unpaidTotal: 'إجمالي غير المدفوع',
  noOrdersForCustomer: 'لا توجد طلبات لهذا العميل.',
} as const

const ARABIC_INVOICE_OVERRIDES = {
  invoiceNumber: 'رقم الفاتورة',
  issueDate: 'تاريخ الإصدار',
  billFrom: 'صادر من',
  billTo: 'صادر إلى',
  itemColumn: 'المنتج',
  qty: 'الكمية',
  unitPrice: 'سعر الوحدة',
  lineTotal: 'الإجمالي',
  subtotal: 'المجموع الفرعي',
  shipping: 'الشحن',
  free: 'مجاني',
  total: 'الإجمالي',
  paymentNote: 'ملاحظات',
  thankYou: 'شكراً لتعاملكم معنا',
} as const

function getAppCopy(lang: Lang): AppCopy {
  if (lang !== 'ar') return WHOLESALE_TEXT.en
  return { ...WHOLESALE_TEXT.ar, ...ARABIC_TEXT_OVERRIDES, ...ARABIC_INVOICE_OVERRIDES } as unknown as AppCopy
}

const SEGMENT_LABELS: Record<string, Record<Lang, string>> = {
  Men: { en: 'Men', ar: 'رجال' },
  Women: { en: 'Women', ar: 'نساء' },
  Kids: { en: 'Kids', ar: 'أطفال' },
  Other: { en: 'Other', ar: 'أخرى' },
}

function getSegmentLabel(segment: string, lang: Lang) {
  return SEGMENT_LABELS[segment]?.[lang] || segment
}

// ─── API helpers ─────────────────────────────────────────
async function apiPost(path: string, body: object) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  })
  return res.json()
}
async function apiGet(path: string) {
  const res = await fetch(`${API}${path}`)
  return res.json()
}
async function apiPatch(path: string, body: object) {
  const res = await fetch(`${API}${path}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  })
  return res.json()
}

// ─── Session helpers ─────────────────────────────────────
function getSession() {
  try {
    const raw = localStorage.getItem('wholesale_session')
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}
function setSession(data: any) {
  localStorage.setItem('wholesale_session', JSON.stringify(data))
}
function clearSession() {
  localStorage.removeItem('wholesale_session')
}
function getLang(): Lang {
  try {
    const raw = localStorage.getItem('wholesale_lang')
    return raw === 'ar' ? 'ar' : 'en'
  } catch { return 'en' }
}
function setLang(lang: Lang) {
  localStorage.setItem('wholesale_lang', lang)
}

// ════════════════════════════════════════════════════
//  MAIN PAGE COMPONENT
// ════════════════════════════════════════════════════
export default function WholesalePage() {
  const [vendor, setVendor] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [lang, setLangState] = useState<Lang>('en')

  useEffect(() => {
    setLangState(getLang())
    const s = getSession()
    if (s?.id) setVendor(s)
    setLoading(false)
  }, [])

  function onLogin(v: any) { setSession(v); setVendor(v) }
  function onLogout() { clearSession(); setVendor(null) }
  function onLangChange(next: Lang) {
    setLangState(next)
    setLang(next)
  }

  const copy = getAppCopy(lang)

  if (loading) return <LoadingScreen copy={copy} />
  if (!vendor) return <LoginScreen onLogin={onLogin} copy={copy} lang={lang} onLangChange={onLangChange} />
  return <Dashboard vendor={vendor} onLogout={onLogout} lang={lang} onLangChange={onLangChange} copy={copy} />
}

// ─── Loading ─────────────────────────────────────────────
function LoadingScreen({ copy }: { copy: AppCopy }) {
  return (
    <div className="h-screen w-full flex flex-col items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50 gap-4">
      <Loader2 className="animate-spin text-blue-600" size={40} />
      <p className="text-slate-500 animate-pulse font-medium">{copy.loadingPortal}</p>
    </div>
  )
}

// ─── Login Screen ────────────────────────────────────────
function LoginScreen({
  onLogin,
  copy,
  lang,
  onLangChange,
}: {
  onLogin: (v: any) => void
  copy: AppCopy
  lang: Lang
  onLangChange: (next: Lang) => void
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [showPw, setShowPw] = useState(false)
  const isArabic = lang === 'ar'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const res = await apiPost('/api/wholesale/login', { username, password })
      if (res?.error) { setError(copy.invalidCredentials); return }
      if (res?.data) { onLogin(res.data); return }
      setError(copy.unexpectedResponse)
    } catch { setError(copy.networkError) } finally { setBusy(false) }
  }

  return (
    <div dir={isArabic ? 'rtl' : 'ltr'} className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-950 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8 relative">
          <button
            type="button"
            onClick={() => onLangChange(lang === 'ar' ? 'en' : 'ar')}
            className={`absolute top-0 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-white/15 ${isArabic ? 'left-0' : 'right-0'}`}
          >
            {lang === 'ar' ? copy.arabic : copy.english}
          </button>
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl shadow-xl shadow-blue-500/25 mb-4">
            <Package className="text-white" size={32} />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">{copy.loginTitle}</h1>
          <p className="text-blue-300/70 text-sm mt-1 uppercase tracking-widest font-semibold">{copy.loginSubtitle}</p>
        </div>
        <form onSubmit={handleSubmit} className="bg-white/10 backdrop-blur-xl border border-white/10 rounded-3xl p-8 space-y-5 shadow-2xl">
          <div>
            <label className="text-[10px] font-bold text-blue-200/80 uppercase tracking-widest block mb-2">{copy.username}</label>
            <input
              value={username} onChange={e => setUsername(e.target.value)}
              className="w-full bg-white/10 border border-white/10 rounded-xl px-4 py-3 text-white text-sm font-medium placeholder-white/30 outline-none focus:ring-2 focus:ring-blue-500/50 transition"
              placeholder={copy.usernamePlaceholder}
              autoFocus
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-blue-200/80 uppercase tracking-widest block mb-2">{copy.password}</label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={password} onChange={e => setPassword(e.target.value)}
                className={`w-full bg-white/10 border border-white/10 rounded-xl px-4 py-3 text-white text-sm font-medium placeholder-white/30 outline-none focus:ring-2 focus:ring-blue-500/50 transition ${isArabic ? 'pl-12' : 'pr-12'}`}
                placeholder={copy.passwordPlaceholder}
              />
              <button type="button" onClick={() => setShowPw(!showPw)} className={`absolute top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition ${isArabic ? 'left-3' : 'right-3'}`}>
                {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>
          {error && <p className="text-red-400 text-xs font-bold bg-red-500/10 px-3 py-2 rounded-xl">{error}</p>}
          <button
            disabled={busy}
            className="w-full py-3.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold rounded-xl shadow-lg shadow-blue-600/25 transition-all active:scale-[0.98] disabled:opacity-60 text-sm uppercase tracking-wider"
          >
            {busy ? <Loader2 className="animate-spin mx-auto" size={20} /> : copy.signIn}
          </button>
        </form>
        <p className="text-center text-white/20 text-xs mt-6">{copy.contactAdmin}</p>
      </div>
    </div>
  )
}

// ─── Dashboard Shell ─────────────────────────────────────
function Dashboard({
  vendor,
  onLogout,
  lang,
  onLangChange,
  copy,
}: {
  vendor: any
  onLogout: () => void
  lang: Lang
  onLangChange: (next: Lang) => void
  copy: AppCopy
}) {
  const [activeTab, setActiveTab] = useState('overview')
  const [products, setProducts] = useState<any[]>([])
  const [loadingProducts, setLoadingProducts] = useState(true)
  const [orderStats, setOrderStats] = useState<any>(null)
  const [showSettings, setShowSettings] = useState(false)
  const profileImage = vendor.profile_image || vendor.profileImage || vendor.avatar || ''
  const vendorInitial = (vendor.name || vendor.username || 'V').charAt(0).toUpperCase()

  async function refreshProducts() {
    setLoadingProducts(true)
    try {
      const res = await apiGet(`/api/wholesale/vendors/${vendor.id}/products`)
      setProducts(res?.data || [])
    } catch { setProducts([]) }
    finally { setLoadingProducts(false) }
  }

  async function refreshOrders() {
    try {
      const res = await apiGet(`/api/wholesale/vendors/${vendor.id}/orders`)
      setOrderStats(res?.data || null)
    } catch { /* ignore */ }
  }

  useEffect(() => { refreshProducts(); refreshOrders() }, [vendor.id])
  const isArabic = lang === 'ar'

  function toggleLang() {
    const next = lang === 'ar' ? 'en' : 'ar'
    onLangChange(next)
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'overview': return <OverviewTab products={products} loading={loadingProducts} orderStats={orderStats} copy={copy} lang={lang} />
      case 'inventory': return <InventoryTab products={products} loading={loadingProducts} copy={copy} lang={lang} />
      case 'create-order': return <CreateOrderTabSimpleInvoice vendor={vendor} products={products} onDone={() => { refreshOrders(); setActiveTab('overview') }} copy={copy} lang={lang} />
      case 'add-new': return <AddNewTab vendor={vendor} onDone={() => { refreshProducts(); setActiveTab('inventory') }} copy={copy} lang={lang} />
      case 'orders': return <OrdersTab vendor={vendor} copy={copy} lang={lang} />
      case 'customers': return <CustomersTab vendor={vendor} copy={copy} lang={lang} />
      default: return <OverviewTab products={products} loading={loadingProducts} orderStats={orderStats} copy={copy} lang={lang} />
    }
  }

  return (
    <div dir={isArabic ? 'rtl' : 'ltr'} className="flex flex-col md:flex-row h-screen bg-slate-50 text-slate-900 overflow-hidden" style={{ fontFamily: isArabic ? "'Tajawal', 'Noto Sans Arabic', system-ui, sans-serif" : "'Inter', system-ui, sans-serif" }}>
      {/* Desktop Sidebar */}
      <nav className="hidden md:flex w-64 bg-white border-r border-slate-200 flex-col">
        <div className="p-6 border-b border-slate-100">
          <h1 className="text-xl font-bold bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 bg-clip-text text-transparent flex items-center gap-2">
            <Package className="text-cyan-600" size={22} />
            {copy.brand}
          </h1>
          <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-wider font-semibold">{copy.portal}</p>
        </div>
        <div className="flex-1 p-4 space-y-2">
          <NavItem active={activeTab==='overview'} onClick={()=>setActiveTab('overview')} icon={<LayoutDashboard size={20}/>} label={copy.overview} />
          <NavItem active={activeTab==='inventory'} onClick={()=>setActiveTab('inventory')} icon={<Package size={20}/>} label={copy.inventory} />
          <NavItem active={activeTab==='orders'} onClick={()=>setActiveTab('orders')} icon={<ClipboardList size={20}/>} label={copy.orders} />
          <NavItem active={activeTab==='customers'} onClick={()=>setActiveTab('customers')} icon={<Users size={20}/>} label={copy.customers} />
          <button onClick={()=>setActiveTab('create-order')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${activeTab==='create-order' ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-200' : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200'}`}>
            <ShoppingCart size={20}/>
            <span className="font-bold text-sm">{copy.createOrder}</span>
          </button>
          <NavItem active={activeTab==='add-new'} onClick={()=>setActiveTab('add-new')} icon={<PlusCircle size={20}/>} label={copy.addProduct} />
        </div>
        <div className="p-4 border-t border-slate-100">
          <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-xl">
            <div className="w-9 h-9 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-xl flex items-center justify-center text-white text-sm font-black flex-shrink-0">
              {(vendor.name || 'V').charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-blue-900 truncate">{vendor.name}</p>
              <p className="text-[10px] text-blue-500">{copy.role}</p>
            </div>
            <button onClick={onLogout} className="text-red-400 hover:text-red-600 transition-colors" title={copy.logout}>
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto pb-24 md:pb-8">
        <div className="sticky top-0 z-30 px-3 pt-3 md:px-8 md:pt-6 bg-slate-50/95 backdrop-blur">
          <div className="relative rounded-2xl md:rounded-[28px] border border-slate-200/80 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.18),_transparent_35%),linear-gradient(135deg,_rgba(15,23,42,0.98),_rgba(30,41,59,0.92)_45%,_rgba(8,47,73,0.98))] px-3 py-2.5 md:px-7 md:py-5 text-white shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex items-center gap-2.5">
                <div className="flex h-9 w-9 md:h-10 md:w-10 items-center justify-center rounded-xl md:rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-500 text-slate-950 shadow-lg shadow-cyan-900/30">
                  <Package size={18} />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm md:text-lg font-black tracking-[0.16em] uppercase">{copy.brand}</p>
                  <p className="hidden md:block text-[10px] uppercase tracking-[0.35em] text-cyan-100/80">{copy.brandTag}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={toggleLang}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[11px] md:px-4 md:py-2 md:text-sm font-bold text-white shadow-lg shadow-slate-950/20 transition hover:bg-white/15"
                >
                  <span className="hidden sm:inline text-cyan-200">{copy.languageLabel}</span>
                  <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px]">{lang === 'ar' ? copy.arabic : copy.english}</span>
                </button>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowSettings(v => !v)}
                    className="inline-flex h-10 w-10 md:h-11 md:w-11 items-center justify-center rounded-xl md:rounded-2xl border border-white/15 bg-white/10 text-white shadow-lg shadow-slate-950/20 transition hover:bg-white/15"
                    title={copy.settingsTitle}
                  >
                    <Settings size={17} />
                  </button>
                  {showSettings && (
                    <div className={`absolute top-12 md:top-14 z-40 w-72 md:w-80 rounded-3xl border border-slate-200 bg-white p-4 md:p-5 text-slate-900 shadow-[0_25px_80px_rgba(15,23,42,0.2)] ${isArabic ? 'left-0' : 'right-0'}`}>
                      <div className="mb-4 flex items-center gap-3">
                        <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 text-white">
                          {profileImage ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={profileImage} alt={vendor.name || copy.vendorName} className="h-full w-full object-cover" />
                          ) : (
                            <span className="text-lg font-black">{vendorInitial}</span>
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-black text-slate-900 truncate">{vendor.name || '-'}</p>
                          <p className="text-xs text-slate-500">{copy.portal}</p>
                        </div>
                      </div>
                      <div className="space-y-3">
                        <SettingsRow label={copy.vendorName} value={vendor.name || '-'} />
                        <SettingsRow label={copy.username} value={vendor.username || vendor.id || '-'} />
                        <SettingsRow label={copy.password} value={copy.passwordValue} />
                      </div>
                      <p className="mt-3 text-xs text-slate-500">{copy.passwordNote}</p>
                      <button
                        type="button"
                        onClick={onLogout}
                        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-bold text-white transition hover:bg-slate-800"
                      >
                        <LogOut size={16} />
                        {copy.logout}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
            </div>
          </div>
        <div className="p-4 md:p-8 pt-5">{renderContent()}</div>
      </main>

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-2 py-2 flex justify-around items-center z-50 shadow-[0_-4px_10px_rgba(0,0,0,0.05)]">
        <MobileNavItem active={activeTab==='overview'} onClick={()=>setActiveTab('overview')} icon={<LayoutDashboard size={20}/>} label={copy.home} />
        <MobileNavItem active={activeTab==='inventory'} onClick={()=>setActiveTab('inventory')} icon={<Package size={20}/>} label={copy.stock} />
        <div className="relative -top-5">
          <button onClick={()=>setActiveTab('create-order')} className={`w-13 h-13 rounded-full flex items-center justify-center shadow-lg transition-transform active:scale-90 p-3 ${activeTab==='create-order'?'bg-emerald-600 text-white shadow-emerald-300':'bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-emerald-300'}`}>
            <ShoppingCart size={24} />
          </button>
        </div>
        <MobileNavItem active={activeTab==='orders'} onClick={()=>setActiveTab('orders')} icon={<ClipboardList size={20}/>} label={copy.orders} />
        <MobileNavItem active={activeTab==='customers'} onClick={()=>setActiveTab('customers')} icon={<Users size={20}/>} label={copy.customers} />
        <MobileNavItem active={activeTab==='add-new'} onClick={()=>setActiveTab('add-new')} icon={<PlusCircle size={20}/>} label={copy.add} />
      </nav>
    </div>
  )
}

// ─── Nav Items ───────────────────────────────────────────
function NavItem({ active, onClick, icon, label }: any) {
  return (
    <button onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${active ? 'bg-blue-600 text-white shadow-lg shadow-blue-200' : 'text-slate-600 hover:bg-slate-100'}`}
    >
      {icon}
      <span className="font-medium text-sm">{label}</span>
    </button>
  )
}
function MobileNavItem({ active, onClick, icon, label }: any) {
  return (
    <button onClick={onClick} className={`flex flex-col items-center gap-1 transition-colors ${active ? 'text-blue-600' : 'text-slate-400'}`}>
      {icon}
      <span className="text-[10px] font-bold uppercase tracking-tighter">{label}</span>
    </button>
  )
}

function SettingsRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">{label}</p>
      <p className="mt-1 text-sm font-bold text-slate-900">{value}</p>
    </div>
  )
}

// ─── Stats Card ──────────────────────────────────────────
function StatsCard({ label, value, sub, icon }: any) {
  return (
    <div className="bg-white p-5 md:p-6 rounded-2xl shadow-sm border border-slate-100 flex items-start gap-4">
      <div className="p-3 bg-slate-50 rounded-xl">{icon}</div>
      <div>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider leading-none mb-1">{label}</p>
        <p className="text-xl md:text-2xl font-bold">{value}</p>
        <p className="text-[10px] md:text-xs text-slate-400 mt-1">{sub}</p>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════
//  OVERVIEW TAB
// ═══════════════════════════════════════════════════
function OverviewTab({ products, loading, orderStats, copy, lang }: { products: any[]; loading: boolean; orderStats: any; copy: AppCopy; lang: Lang }) {
  const locale = getLocale(lang)
  const totalStock = useMemo(() => products.reduce((a, p) => {
    const vars = p.variants || []
    return a + vars.reduce((s: number, v: any) => s + (parseInt(v.inventory_quantity) || 0), 0)
  }, 0), [products])

  const totalValue = useMemo(() => products.reduce((a, p) => {
    const vars = p.variants || []
    return a + vars.reduce((s: number, v: any) => s + (parseFloat(v.price) || 0) * (parseInt(v.inventory_quantity) || 0), 0)
  }, 0), [products])

  const segmentData = useMemo(() => {
    const counts: Record<string, number> = {}
    products.forEach(p => {
      const tags = typeof p.tags === 'string' ? p.tags.split(',').map((t: string) => t.trim()) : []
      const seg = tags.find((t: string) => t.startsWith('segment:'))
      const name = seg ? seg.replace('segment:', '') : 'Other'
      counts[name] = (counts[name] || 0) + 1
    })
    return Object.entries(counts).map(([name, count]) => ({ name: getSegmentLabel(name, lang), count }))
  }, [products, lang])

  return (
    <div className="space-y-6 max-w-6xl mx-auto animate-in">
      <div className="flex flex-col md:flex-row md:justify-between md:items-end gap-4">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold text-slate-900 tracking-tight">{copy.overviewTitle}</h2>
          <p className="text-slate-500 text-sm">{copy.overviewSub}</p>
        </div>
        <div className="bg-white border p-3 rounded-2xl shadow-sm flex items-center gap-3">
          <div className="p-2 bg-blue-50 rounded-lg text-blue-600"><Package size={18}/></div>
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400 block leading-none">{copy.totalProducts}</span>
            <p className="text-lg font-bold">{loading ? '...' : products.length}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
        <StatsCard label={copy.inventoryLevel} value={loading ? '...' : totalStock.toLocaleString(locale)} sub={copy.inventoryLevelSub} icon={<Box size={20} className="text-blue-600" />} />
        <StatsCard label={copy.inventoryValue} value={loading ? '...' : formatDh(totalValue, locale)} sub={copy.inventoryValueSub} icon={<DollarSign size={20} className="text-green-600" />} />
        <StatsCard label={copy.ordersStat} value={orderStats ? orderStats.total_orders : '...'} sub={orderStats ? `${formatDh(orderStats.total_revenue, locale)} ${copy.revenueLabel}` : copy.ordersStatSub} icon={<ShoppingCart size={20} className="text-emerald-600" />} />
        <StatsCard label={copy.unitsSold} value={orderStats ? orderStats.total_units_sold : '...'} sub={copy.unitsSoldSub} icon={<TrendingUp size={20} className="text-orange-600" />} />
      </div>

      {/* Segment breakdown */}
      {segmentData.length > 0 && (
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <h3 className="text-lg font-bold mb-4">{copy.productsBySegment}</h3>
          <div className="space-y-3">
            {segmentData.map(s => (
              <div key={s.name} className="flex items-center gap-4">
                <div className="w-24 text-sm font-semibold text-slate-600">{s.name}</div>
                <div className="flex-1 bg-slate-100 rounded-full h-6 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full flex items-center justify-end pr-2"
                    style={{ width: `${Math.max(10, (s.count / Math.max(products.length, 1)) * 100)}%` }}
                  >
                    <span className="text-[10px] text-white font-bold">{s.count}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent products */}
      {products.length > 0 && (
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <h3 className="text-lg font-bold mb-4">{copy.recentProducts}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {products.slice(0, 6).map((p: any) => (
              <div key={p.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
                <div className="w-12 h-12 rounded-lg bg-white border border-slate-200 overflow-hidden flex items-center justify-center flex-shrink-0">
                  {p.images?.[0]?.src ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.images[0].src} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <ImageIcon size={20} className="text-slate-300" />
                  )}
                </div>
                <div className="overflow-hidden">
                  <p className="text-sm font-bold truncate">{p.title}</p>
                  <p className="text-[10px] text-slate-500">{formatDh(p.variants?.[0]?.price || '0.00', locale)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════
//  INVENTORY TAB
// ═══════════════════════════════════════════════════
function InventoryTab({ products, loading, copy, lang }: { products: any[]; loading: boolean; copy: AppCopy; lang: Lang }) {
  const [search, setSearch] = useState('')
  const [segFilter, setSegFilter] = useState('All')
  const locale = getLocale(lang)

  const filtered = useMemo(() => {
    return products.filter(p => {
      const matchSearch = !search || (p.title || '').toLowerCase().includes(search.toLowerCase())
      if (segFilter === 'All') return matchSearch
      const tags = typeof p.tags === 'string' ? p.tags : ''
      return matchSearch && tags.includes(`segment:${segFilter}`)
    })
  }, [products, search, segFilter])

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-10 animate-in">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold">{copy.inventoryTitle}</h2>
          <p className="text-slate-500 text-sm">{copy.inventorySub}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder={copy.searchProducts}
          className="bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500/30 w-64"
        />
        <select value={segFilter} onChange={e => setSegFilter(e.target.value)}
          className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium outline-none"
        >
          <option value="All">{copy.allSegments}</option>
          {SEGMENTS.map(s => <option key={s} value={s}>{getSegmentLabel(s, lang)}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden overflow-x-auto">
        <table className="w-full text-left min-w-[700px]">
          <thead className="bg-slate-50 text-slate-400 text-[10px] font-bold uppercase tracking-widest">
            <tr>
              <th className="px-6 py-4">{copy.productDetail}</th>
              <th className="px-6 py-4 text-center">{copy.status}</th>
              <th className="px-6 py-4 text-center">{copy.stock}</th>
              <th className="px-6 py-4 text-right">{copy.price}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr><td colSpan={4} className="px-6 py-16 text-center">
                <Loader2 className="animate-spin text-blue-500 mx-auto mb-2" size={24} />
                <p className="text-slate-400 text-sm">{copy.loadingProducts}</p>
              </td></tr>
            )}
            {!loading && filtered.map((p: any) => {
              const qty = (p.variants || []).reduce((s: number, v: any) => s + (parseInt(v.inventory_quantity) || 0), 0)
              const price = p.variants?.[0]?.price || '0.00'
              return (
                <tr key={p.id} className="hover:bg-slate-50/50 transition-colors group">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-slate-100 overflow-hidden border border-slate-200 flex-shrink-0 flex items-center justify-center">
                        {p.images?.[0]?.src ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.images[0].src} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <ImageIcon size={20} className="text-slate-300" />
                        )}
                      </div>
                      <div>
                        <p className="font-bold text-slate-900 group-hover:text-blue-600 transition-colors">{p.title || copy.untitled}</p>
                        <p className="text-[10px] text-slate-400 font-mono">ID: {p.id}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-tight ${p.status === 'active' ? 'bg-green-50 text-green-600' : 'bg-slate-100 text-slate-500'}`}>
                      {p.status === 'active' ? copy.activeStatus : copy.inactiveStatus}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-center font-bold text-sm">{qty}</td>
                  <td className="px-6 py-4 text-right font-bold">{formatDh(price, locale)}</td>
                </tr>
              )
            })}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={4} className="px-6 py-16 text-center">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-16 h-16 bg-slate-50 text-slate-200 rounded-full flex items-center justify-center"><Package size={32}/></div>
                  <p className="text-slate-400 font-medium">{copy.noProducts}</p>
                </div>
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════
//  ADD NEW PRODUCT TAB
// ═══════════════════════════════════════════════════
function AddNewTab({ vendor, onDone, copy, lang }: { vendor: any; onDone: () => void; copy: AppCopy; lang: Lang }) {
  const [saving, setSaving] = useState(false)
  const [colorInput, setColorInput] = useState('')
  const [form, setForm] = useState({
    title: '',
    description: '',
    cogPrice: '', salePrice: '',
    segment: SEGMENTS[0],
    season: SEASONS[0],
    colors: [] as string[],
    sizeGroups: [createStockVariantRow()] as StockVariantFormRow[],
    variantGroupId: '',
  })
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<string | null>(null)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [aiStatus, setAiStatus] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const locale = getLocale(lang)
  const unitSalePrice = toNumber(form.salePrice)
  const netProfit = useMemo(() => {
    const cog = toNumber(form.cogPrice)
    return unitSalePrice - cog
  }, [form.cogPrice, unitSalePrice])
  const isArabic = lang === 'ar'

  function addColor() {
    const c = colorInput.trim()
    if (!c || form.colors.includes(c)) return
    setForm(f => ({ ...f, colors: [...f.colors, c] }))
    setColorInput('')
  }
  function removeColor(c: string) {
    setForm(f => ({ ...f, colors: f.colors.filter(x => x !== c) }))
  }

  function addSizeGroup() {
    setForm(f => ({ ...f, sizeGroups: [...f.sizeGroups, createStockVariantRow()] }))
  }
  function removeSizeGroup(idx: number) {
    setForm(f => ({ ...f, sizeGroups: f.sizeGroups.filter((_, i) => i !== idx) }))
  }
  function updateSizeGroup(idx: number, key: keyof StockVariantFormRow, value: string) {
    setForm(f => ({
      ...f,
      sizeGroups: f.sizeGroups.map((group, groupIdx) => {
        if (groupIdx !== idx) return group
        if (key === 'sku') return { ...group, sku: value }
        return { ...group, [key]: parseInt(value, 10) || 0 }
      }),
    }))
  }

  // Handle image selection (camera or file)
  async function handleImageCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImageFile(file)
    const reader = new FileReader()
    reader.onload = (ev) => setImagePreview(ev.target?.result as string)
    reader.readAsDataURL(file)
    setUploading(true)
    setUploadStatus(copy.uploadingImage)
    setAiStatus(copy.uploadingImage)
    try {
      const fd = new FormData()
      fd.append('image', file)
      const res = await fetch(`${API}/api/wholesale/upload-image`, { method: 'POST', body: fd })
      const data = await res.json()
      if (data?.data?.url) {
        setImageUrl(data.data.url)
        setUploadStatus(copy.imageUploaded)
        setAiStatus(copy.imageUploaded)
      } else {
        setUploadStatus(copy.uploadFailed)
        setAiStatus(copy.uploadFailed)
      }
    } catch {
      setUploadStatus(copy.uploadError)
      setAiStatus(copy.uploadError)
    } finally {
      setUploading(false)
    }
  }

  // Send image to ChatGPT for analysis
  async function handleAnalyzeImage() {
    if (!imageUrl) return
    setAnalyzing(true)
    setAiStatus('🤖 Analyzing product with AI... This may take a few seconds.')
    try {
      const res = await apiPost('/api/wholesale/analyze-image', { image_url: imageUrl })
      if (res?.data) {
        const ai = res.data
        setForm(f => ({
          ...f,
          title: ai.title || f.title,
          description: (ai.benefits || []).join('. ') || f.description,
          colors: (ai.colors && ai.colors.length > 0) ? ai.colors : f.colors,
        }))
        setAiStatus('✅ AI analysis complete! Title and description updated.')
      } else {
        setAiStatus('AI analysis returned no data. Please fill manually.')
      }
    } catch {
      setAiStatus('AI analysis failed. Please fill manually.')
    } finally {
      setAnalyzing(false)
    }
  }

  function removeImage() {
    setImageFile(null)
    setImagePreview(null)
    setImageUrl(null)
    setAiStatus(null)
    setUploadStatus(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleSubmit() {
    if (!imageUrl) { alert(copy.uploadImageRequired); return }
    if (form.colors.length === 0) { alert(copy.colorRequired); return }
    if (unitSalePrice <= 0) { alert(copy.unitSalePriceRequired); return }
    if (form.sizeGroups.length === 0) { alert(copy.stockVariantRequired); return }
    if (form.sizeGroups.some(group => !group.sku.trim())) { alert(copy.skuRequired); return }
    if (form.sizeGroups.some(group => group.pcsPerCrate <= 0)) { alert(copy.piecesPerCrateRequired); return }
    if (form.sizeGroups.some(group => group.crateQty <= 0)) { alert(copy.crateQuantityRequired); return }
    setSaving(true)
    try {
      const res = await apiPost(`/api/wholesale/vendors/${vendor.id}/products`, {
        cog_price: parseFloat(form.cogPrice) || undefined,
        sale_price: unitSalePrice || undefined,
        colors: form.colors.length > 0 ? form.colors : undefined,
        size_groups: form.sizeGroups.map(group => ({
          from: group.from,
          to: group.to,
          pcs_per_crate: group.pcsPerCrate,
          crate_quantity: group.crateQty,
          sku: group.sku.trim(),
        })),
        image_url: imageUrl || undefined,
      })
      if (res?.error) { alert(`${copy.errorPrefix}: ${res.error}`); return }
      alert(copy.productCreatedSuccess)
      onDone()
    } catch (e: any) {
      alert(`${copy.saveProductError} ${e?.message || e}`)
    } finally { setSaving(false) }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-24 animate-in">
      <div>
        <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-900">{copy.addProductTitle}</h2>
        <p className="text-slate-500 text-sm">{copy.addProductSub}</p>
      </div>

      {/* ── CAMERA / IMAGE CAPTURE SECTION ── */}
      <section className="bg-gradient-to-br from-blue-50 via-indigo-50 to-violet-50 p-5 rounded-3xl border border-blue-200 shadow-sm">
        <h3 className="text-[10px] font-bold uppercase text-blue-600 mb-4 flex items-center gap-2 tracking-widest">
          <Camera size={14} /> {copy.productPhoto}
        </h3>
        {!imagePreview ? (
          <div className="flex flex-col items-center gap-4 py-8">
            <div className="w-20 h-20 bg-white/80 rounded-3xl flex items-center justify-center shadow-inner border-2 border-dashed border-blue-300">
              <Camera size={36} className="text-blue-400" />
            </div>
            <p className="text-sm text-blue-600 font-medium text-center">{copy.takePhotoOrUpload}</p>
            <p className="text-[10px] text-blue-400 text-center">{copy.generatedAfterCreate}</p>
            <div className="flex gap-3">
              <label className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-2xl font-bold shadow-lg shadow-blue-200 transition-all active:scale-95 flex items-center gap-2 text-sm">
                <Camera size={18} />
                {copy.takePhoto}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleImageCapture}
                  className="hidden"
                />
              </label>
              <label className="cursor-pointer bg-white hover:bg-slate-50 text-blue-600 px-6 py-3 rounded-2xl font-bold shadow-md border border-blue-200 transition-all active:scale-95 flex items-center gap-2 text-sm">
                <ImageIcon size={18} />
                {copy.upload}
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageCapture}
                  className="hidden"
                />
              </label>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="relative rounded-2xl overflow-hidden border-2 border-blue-200 shadow-md bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imagePreview} alt={copy.productPreview} className="w-full max-h-80 object-contain bg-white" />
              <button
                onClick={removeImage}
                className={`absolute top-3 bg-red-500 hover:bg-red-600 text-white p-2 rounded-full shadow-lg transition-all ${isArabic ? 'left-3' : 'right-3'}`}
              >
                <X size={16} />
              </button>
            </div>
            {/* AI Analyze Button */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 bg-white/80 text-slate-500 px-6 py-3.5 rounded-2xl font-bold border border-blue-100 text-sm text-center">
                {copy.backgroundAnalysisStarts}
              </div>
              <button
                onClick={handleAnalyzeImage}
                disabled={analyzing || !imageUrl}
                className="hidden"
              >
                {analyzing ? <Loader2 className="animate-spin" size={18} /> : <span className="text-lg">🤖</span>}
                {analyzing ? 'Analyzing...' : 'Analyze with AI'}
              </button>
              <label className="cursor-pointer bg-white hover:bg-slate-50 text-blue-600 px-5 py-3.5 rounded-2xl font-bold shadow-md border border-blue-200 transition-all active:scale-95 flex items-center justify-center gap-2 text-sm">
                <RefreshCw size={16} />
                {copy.retake}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleImageCapture}
                  className="hidden"
                />
              </label>
            </div>
            {/* Status */}
            {aiStatus && (
              <div className={`px-4 py-3 rounded-xl text-xs font-bold ${aiStatus.startsWith('✅') ? 'bg-green-50 text-green-700 border border-green-200' : aiStatus.startsWith('🤖') ? 'bg-violet-50 text-violet-700 border border-violet-200' : 'bg-blue-50 text-blue-700 border border-blue-200'}`}>
                {aiStatus}
              </div>
            )}
          </div>
        )}
        {uploading && (
          <div className="flex items-center gap-2 mt-3 text-blue-600">
            <Loader2 className="animate-spin" size={16} />
            <span className="text-xs font-bold">{copy.uploadingImage}</span>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* LEFT COLUMN */}
        <div className="space-y-6">
          <section className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm">
            <h3 className="text-[10px] font-bold uppercase text-slate-400 mb-4 flex items-center gap-2 tracking-widest">
              <TagIcon size={14} /> {copy.colorsTitle}
            </h3>
            <div className="space-y-4">
              <div className="hidden">
                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">Product Title</label>
                <input type="text" value={form.title} onChange={e => setForm({...form, title: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none" placeholder="Enter product title" />
              </div>
              <div className="hidden">
                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">Description</label>
                <textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium outline-none resize-none h-24" placeholder="Product description..." />
              </div>
              <div className="hidden grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">Segment</label>
                  <select value={form.segment} onChange={e => setForm({...form, segment: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-bold text-sm outline-none">
                    {SEGMENTS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">Season</label>
                  <select value={form.season} onChange={e => setForm({...form, season: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-bold text-sm outline-none">
                    {SEASONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              {/* Colors */}
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">{copy.colorsLabel}</label>
                <div className="flex gap-2 mb-3">
                  <input type="text" value={colorInput} onChange={e => setColorInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addColor())}
                    placeholder={copy.colorPlaceholder} className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm font-medium outline-none" />
                  <button onClick={addColor} className="bg-blue-600 text-white px-4 rounded-xl font-bold text-xs">{copy.addColor}</button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {form.colors.map(c => (
                    <span key={c} className="inline-flex items-center gap-1.5 bg-blue-50 text-blue-600 px-3 py-1.5 rounded-full text-xs font-bold border border-blue-100">
                      {c} <button onClick={() => removeColor(c)}><X size={14} /></button>
                    </span>
                  ))}
                  {form.colors.length === 0 && <p className="text-[10px] text-slate-400 italic">{copy.noColorsYet}</p>}
                </div>
              </div>
              <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs text-amber-700">
                {copy.hiddenCatalogNote}
              </div>
            </div>
          </section>
        </div>

        {/* RIGHT COLUMN */}
        <div className="space-y-6">
          {/* Pricing */}
          <section className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm">
            <h3 className="text-[10px] font-bold uppercase text-slate-400 mb-4 flex items-center gap-2 tracking-widest">
              <DollarSign size={14} /> {copy.financialsTitle}
            </h3>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">{copy.cogPrice}</label>
                  <input type="number" value={form.cogPrice} onChange={e => setForm({...form, cogPrice: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold" placeholder="0.00" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">{copy.salePrice}</label>
                  <input type="number" value={form.salePrice} onChange={e => setForm({...form, salePrice: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold" placeholder="0.00" />
                </div>
              </div>
              <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-700">
                {copy.unitPriceNote}
              </div>
              <div className="flex items-center justify-between p-4 bg-green-50 rounded-2xl border border-green-100 font-bold text-green-700">
                <span className="text-xs uppercase">{copy.estimatedProfit}</span>
                <span className="text-xl">{formatDh(netProfit, locale)}</span>
              </div>
            </div>
          </section>

          {/* Size Groups / Quantities */}
          <section className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-[10px] font-bold uppercase text-slate-400 flex items-center gap-2 tracking-widest">
                <Layers size={14} /> {copy.stockVariants}
              </h3>
              <button onClick={addSizeGroup} className="text-blue-600 text-[10px] font-black flex items-center gap-1"><Plus size={12} /> {copy.addRange}</button>
            </div>
            <div className="space-y-3">
              {form.sizeGroups.map((group, idx) => (
                <div key={idx} className="space-y-3 p-4 bg-slate-50 rounded-2xl border border-slate-100 relative">
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    <div className="bg-white p-2 rounded-xl border border-slate-200 flex flex-col">
                      <span className="text-[9px] text-slate-400 font-bold uppercase mb-1">{copy.sku}</span>
                      <input type="text" value={group.sku}
                        onChange={e => updateSizeGroup(idx, 'sku', e.target.value)}
                        className="font-bold text-sm outline-none w-full" placeholder="SKU-001" />
                    </div>
                    <div className="bg-white p-2 rounded-xl border border-slate-200 flex flex-col">
                      <span className="text-[9px] text-slate-400 font-bold uppercase mb-1">{copy.from}</span>
                      <input type="number" value={group.from}
                        onChange={e => updateSizeGroup(idx, 'from', e.target.value)}
                        className="font-bold text-sm outline-none w-full" />
                    </div>
                    <div className="bg-white p-2 rounded-xl border border-slate-200 flex flex-col">
                      <span className="text-[9px] text-slate-400 font-bold uppercase mb-1">{copy.to}</span>
                      <input type="number" value={group.to}
                        onChange={e => updateSizeGroup(idx, 'to', e.target.value)}
                        className="font-bold text-sm outline-none w-full" />
                    </div>
                    <div className="bg-white p-2 rounded-xl border border-slate-200 flex flex-col">
                      <span className="text-[9px] text-slate-400 font-bold uppercase mb-1">{copy.piecesPerCrate}</span>
                      <input type="number" value={group.pcsPerCrate}
                        onChange={e => updateSizeGroup(idx, 'pcsPerCrate', e.target.value)}
                        className="font-bold text-sm outline-none w-full" />
                    </div>
                    <div className="bg-blue-600 p-2 rounded-xl flex flex-col border border-blue-700">
                      <span className="text-[9px] text-blue-100 font-bold uppercase mb-1">{copy.qty}</span>
                      <input type="number" value={group.crateQty}
                        onChange={e => updateSizeGroup(idx, 'crateQty', e.target.value)}
                        className="font-bold text-sm outline-none w-full text-white bg-transparent" />
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">{copy.variantPreview}</p>
                        <p className="mt-1 text-base font-bold text-slate-900">
                          {buildVariantTitle(group)}
                          <span className="text-sm font-semibold text-slate-500"> · {group.crateQty} {copy.cratesLabel}</span>
                        </p>
                      </div>
                      <div className={`${isArabic ? 'sm:text-left' : 'sm:text-right'}`}>
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">{copy.cratePrice}</p>
                        <p className="mt-1 text-lg font-black text-emerald-600">{formatDh(getVariantCratePrice(unitSalePrice, group), locale)}</p>
                      </div>
                    </div>
                  </div>
                  {form.sizeGroups.length > 1 && (
                    <button onClick={() => removeSizeGroup(idx)} className="absolute -top-2 -right-2 md:relative md:top-0 md:right-0 bg-red-500 text-white md:bg-transparent md:text-slate-300 md:hover:text-red-500 p-1 rounded-full shadow-md md:shadow-none">
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <p className="text-[10px] text-slate-400 mt-3">{copy.stockVariantNote}</p>
          </section>

          <section className="hidden bg-white p-5 rounded-3xl border border-slate-200 shadow-sm">
            <h3 className="text-[10px] font-bold uppercase text-slate-400 mb-4 flex items-center gap-2 tracking-widest">
              <TagIcon size={14} /> Variant Group ID (SKU)
            </h3>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">Group ID</label>
              <input type="text" value={form.variantGroupId} onChange={e => setForm({...form, variantGroupId: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none" placeholder="e.g. SKU-0828-2" />
              <p className="text-[10px] text-slate-400 mt-2">This ID will be set as the SKU on all variants in Shopify</p>
            </div>
          </section>

          {/* Vendor Tag Info */}
          <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100">
            <p className="text-[10px] text-blue-600 font-bold uppercase tracking-tight mb-1">{copy.productsTaggedAs}</p>
            <p className="text-sm font-mono font-bold text-blue-900">Vendor: {vendor.name}</p>
            <p className="text-[10px] text-blue-500 mt-1">{copy.vendorFieldNote}</p>
          </div>
        </div>
      </div>

      {/* ── SAVE BUTTON AT BOTTOM ── */}
      <div className="pt-4">
        <button
          onClick={handleSubmit}
          disabled={saving || uploading}
          className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white py-4 rounded-2xl font-bold shadow-xl shadow-blue-200 transition-all active:scale-[0.98] disabled:opacity-60 flex items-center justify-center gap-3 text-base uppercase tracking-wider"
        >
          {saving && <Loader2 className="animate-spin" size={20} />}
          {saving ? copy.creatingProduct : copy.createProductCta}
        </button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════
//  CREATE ORDER TAB
// ═══════════════════════════════════════════════════
function CreateOrderTab({ vendor, products, onDone, copy, lang }: { vendor: any; products: any[]; onDone: () => void; copy: AppCopy; lang: Lang }) {
  const [search, setSearch] = useState('')
  const [lineItems, setLineItems] = useState<{ variant_id: number; quantity: number; title: string; sku: string; price: string; image: string | null; variantTitle: string }[]>([])
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [address, setAddress] = useState({ address1: 'NA', city: 'Casablanca', province: 'Casablanca-Settat', zip: '20000', country: 'MA' })
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState<any>(null)
  const [showProducts, setShowProducts] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)
  const invoiceRef = useRef<HTMLDivElement>(null)
  const isArabic = lang === 'ar'
  const locale = getLocale(lang)

  // Flatten variants for search
  const allVariants = useMemo(() => {
    const arr: any[] = []
    products.forEach(p => {
      (p.variants || []).forEach((v: any) => {
        arr.push({
          variant_id: v.id,
          title: p.title,
          variant_title: v.title,
          sku: v.sku || '',
          price: v.price || '0.00',
          inventory: v.inventory_quantity || 0,
          image: p.images?.[0]?.src || null,
        })
      })
    })
    return arr
  }, [products])

  const filtered = useMemo(() => {
    if (!search) return allVariants.slice(0, 20)
    const q = search.toLowerCase()
    return allVariants.filter(v =>
      v.title.toLowerCase().includes(q) || v.sku.toLowerCase().includes(q) || v.variant_title.toLowerCase().includes(q)
    ).slice(0, 20)
  }, [allVariants, search])

  function addItem(v: any) {
    const existing = lineItems.find(li => li.variant_id === v.variant_id)
    if (existing) {
      setLineItems(lineItems.map(li => li.variant_id === v.variant_id ? { ...li, quantity: li.quantity + 1 } : li))
    } else {
      setLineItems([...lineItems, { variant_id: v.variant_id, quantity: 1, title: v.title, sku: v.sku, price: v.price, image: v.image, variantTitle: v.variant_title }])
    }
    setSearch('')
    setShowProducts(false)
  }

  function updateQty(variantId: number, delta: number) {
    setLineItems(lineItems.map(li => {
      if (li.variant_id === variantId) {
        const newQty = Math.max(1, li.quantity + delta)
        return { ...li, quantity: newQty }
      }
      return li
    }))
  }

  function removeItem(variantId: number) {
    setLineItems(lineItems.filter(li => li.variant_id !== variantId))
  }

  const orderTotal = useMemo(() => {
    return lineItems.reduce((sum, li) => sum + (parseFloat(li.price) || 0) * li.quantity, 0).toFixed(2)
  }, [lineItems])
  const invoiceNumber = success?.name || `#${success?.order_number || ''}`
  const invoiceTotal = toNumber(success?.total_price || orderTotal)

  async function handleSubmit() {
    if (!customerName.trim() || !customerPhone.trim()) { alert(copy.customerNamePhoneRequired); return }
    if (lineItems.length === 0) { alert(copy.addAtLeastOneProduct); return }
    setSaving(true)
    try {
      const body = {
        customer_name: customerName.trim(),
        customer_phone: customerPhone.trim(),
        customer_address1: address.address1,
        customer_city: address.city,
        customer_province: address.province,
        customer_zip: address.zip,
        customer_country: address.country,
        line_items: lineItems.map(li => ({ variant_id: li.variant_id, quantity: li.quantity })),
      }
      const res = await apiPost(`/api/wholesale/vendors/${vendor.id}/orders`, body)
      if (res?.error) { alert(`${copy.errorPrefix}: ${res.error}`); setSaving(false); return }
      setSuccess(res?.data)
    } catch (e: any) { alert(`${copy.failedPrefix}: ${e.message}`) }
    finally { setSaving(false) }
  }

  // Download invoice as image
  async function downloadInvoice() {
    if (!invoiceRef.current) return
    try {
      const html2canvas = (await import('html2canvas')).default
      const canvas = await html2canvas(invoiceRef.current, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
      })
      const link = document.createElement('a')
      link.download = `invoice-${success?.name || success?.order_number || 'order'}.png`
      link.href = canvas.toDataURL('image/png')
      link.click()
    } catch (err) {
      console.error('Failed to generate invoice image:', err)
      alert(copy.invoiceImageFailed)
    }
  }

  // Share invoice as image (mobile share API or fallback to download)
  async function shareInvoice() {
    if (!invoiceRef.current) return
    try {
      const html2canvas = (await import('html2canvas')).default
      const canvas = await html2canvas(invoiceRef.current, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
      })
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
      if (!blob) { downloadInvoice(); return }
      if (navigator.share && navigator.canShare) {
        const file = new File([blob], `invoice-${success?.name || 'order'}.png`, { type: 'image/png' })
        const shareData = { files: [file], title: `${copy.invoice} ${success?.name || ''}`, text: `${copy.invoice} ${vendor.name}` }
        if (navigator.canShare(shareData)) {
          await navigator.share(shareData)
          return
        }
      }
      // Fallback: download
      downloadInvoice()
    } catch (err) {
      console.error('Share failed:', err)
      downloadInvoice()
    }
  }

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setShowProducts(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const invoiceDate = new Date().toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' })
  const invoiceTime = new Date().toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  const totalItems = lineItems.reduce((s, li) => s + li.quantity, 0)
  const customerAddressLine = address.address1 && address.address1 !== 'NA' ? address.address1 : null

  if (success) {
    return (
      <div className="max-w-3xl mx-auto space-y-6 pb-28 animate-in">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button onClick={downloadInvoice} className="flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white py-3.5 rounded-2xl font-bold shadow-lg shadow-blue-200 transition-all active:scale-[0.98] text-sm">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            {copy.downloadInvoice}
          </button>
          <button onClick={shareInvoice} className="flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white py-3.5 rounded-2xl font-bold shadow-lg shadow-emerald-200 transition-all active:scale-[0.98] text-sm">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
            {copy.shareInvoice}
          </button>
        </div>

        <div
          ref={invoiceRef}
          dir={isArabic ? 'rtl' : 'ltr'}
          className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-[0_28px_80px_rgba(15,23,42,0.12)]"
          style={{ fontFamily: isArabic ? "'Tajawal', 'Noto Sans Arabic', system-ui, sans-serif" : "'Inter', 'Segoe UI', system-ui, sans-serif" }}
        >
          <div className="bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.18),_transparent_36%),linear-gradient(135deg,_rgba(15,23,42,1),_rgba(30,41,59,0.95)_46%,_rgba(8,47,73,1))] px-5 py-6 md:px-8 md:py-8 text-white">
            <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
              <div className="space-y-3">
                <div className="inline-flex items-center rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.25em] text-cyan-100">
                  {copy.invoice}
                </div>
                <div>
                  <h3 className="text-2xl md:text-3xl font-black tracking-tight">{success.name || `#${success.order_number}`}</h3>
                  <p className="mt-1 text-sm text-slate-200">{vendor.name}</p>
                </div>
              </div>
              <div className={`flex flex-col gap-2 ${isArabic ? 'md:items-start' : 'md:items-end'}`}>
                <span className="inline-flex items-center rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-bold text-emerald-200 ring-1 ring-inset ring-emerald-300/25">
                  {copy.confirmed}
                </span>
                <p className="text-xs uppercase tracking-[0.25em] text-slate-300">{copy.wholesaleVendor}</p>
              </div>
            </div>
          </div>

          <div className="space-y-5 p-5 md:p-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">{copy.customer}</p>
                <p className="mt-3 text-lg font-bold text-slate-900">{customerName}</p>
                <p className="mt-1 text-sm text-slate-600">{customerPhone}</p>
                <p className="mt-2 text-sm text-slate-500">{address.address1}</p>
                <p className="text-sm text-slate-500">{address.city} · {address.province}</p>
              </div>
              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">{copy.invoiceDetails}</p>
                <div className="mt-3 space-y-2 text-sm text-slate-700">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-slate-500">{copy.date}</span>
                    <span className="font-bold">{invoiceDate}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-slate-500">{copy.time}</span>
                    <span className="font-bold">{invoiceTime}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-slate-500">{copy.status}</span>
                    <span className="font-bold text-emerald-600">{copy.confirmed}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-3xl border border-slate-200">
              <div className="flex items-center justify-between bg-slate-50 px-4 py-3">
                <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">{copy.itemColumn}</p>
                <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">{copy.total}</p>
              </div>
              <div className="divide-y divide-slate-100">
                {lineItems.map(li => (
                  <div key={li.variant_id} className="p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="h-14 w-14 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 flex-shrink-0 flex items-center justify-center">
                          {li.image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={li.image} alt="" className="h-full w-full object-cover" crossOrigin="anonymous" />
                          ) : (
                            <Package size={18} className="text-slate-300" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-900">{li.title}</p>
                          <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-slate-500">
                            {li.variantTitle !== 'Default Title' && (
                              <span className="rounded-full bg-slate-100 px-2.5 py-1">{li.variantTitle}</span>
                            )}
                            {li.sku && (
                              <span className="rounded-full bg-slate-100 px-2.5 py-1">{copy.sku}: {li.sku}</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center sm:min-w-[260px]">
                        <div className="rounded-2xl bg-slate-50 px-3 py-2">
                          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">{copy.qty}</p>
                          <p className="mt-1 text-sm font-bold text-slate-900">{li.quantity}</p>
                        </div>
                        <div className="rounded-2xl bg-slate-50 px-3 py-2">
                          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">{copy.price}</p>
                          <p className="mt-1 text-sm font-bold text-slate-900">${li.price}</p>
                        </div>
                        <div className="rounded-2xl bg-blue-50 px-3 py-2">
                          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-500">{copy.total}</p>
                          <p className="mt-1 text-sm font-black text-blue-700">${(parseFloat(li.price) * li.quantity).toFixed(2)}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[1fr_280px] gap-4">
              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">{copy.paymentNote}</p>
                <p className="mt-3 text-sm text-slate-600">{copy.thankYou}</p>
                <p className="mt-2 text-xs text-slate-400">{vendor.name} · MMD Wholesale · {invoiceDate}</p>
              </div>
              <div className="rounded-3xl border border-slate-200 bg-slate-950 p-5 text-white">
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-sm text-slate-300">
                    <span>{copy.subtotal} ({totalItems} {copy.itemsLabel})</span>
                    <span className="font-bold text-white">${orderTotal}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm text-slate-300">
                    <span>{copy.shipping}</span>
                    <span className="font-bold text-white">{copy.free}</span>
                  </div>
                </div>
                <div className="mt-4 border-t border-white/10 pt-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold uppercase tracking-[0.2em] text-cyan-200">{copy.total}</span>
                    <span className="text-2xl font-black">${parseFloat(String(success.total_price || orderTotal)).toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button onClick={() => { setSuccess(null); setLineItems([]); setCustomerName(''); setCustomerPhone('') }} className="px-6 py-3 bg-white border border-slate-200 rounded-xl font-bold text-sm hover:bg-slate-50">
            {copy.newOrder}
          </button>
          <button onClick={onDone} className="px-6 py-3 bg-emerald-600 text-white rounded-xl font-bold text-sm hover:bg-emerald-700">
            {copy.backToOverview}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-28 animate-in">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
          <div className="p-2 bg-emerald-100 rounded-xl"><ShoppingCart size={22} className="text-emerald-600" /></div>
          {copy.createOrderTitle}
        </h2>
        <p className="text-slate-500 text-sm mt-1">{copy.createOrderSub}</p>
      </div>

      {/* Product Search & Selection */}
      <section className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm">
        <h3 className="text-[10px] font-bold uppercase text-slate-400 mb-4 tracking-widest">{copy.addProducts}</h3>
        <div ref={searchRef} className="relative">
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
            <Search size={16} className="text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={e => { setSearch(e.target.value); setShowProducts(true) }}
              onFocus={() => setShowProducts(true)}
              placeholder={copy.searchByProductOrSku}
              className="bg-transparent flex-1 text-sm font-medium outline-none"
            />
          </div>
          {showProducts && (
            <div className="absolute z-40 left-0 right-0 mt-2 bg-white border border-slate-200 rounded-2xl shadow-xl max-h-64 overflow-y-auto">
              {filtered.length === 0 && <p className="p-4 text-sm text-slate-400 text-center">{copy.noProductsFound}</p>}
              {filtered.map(v => (
                <button key={v.variant_id} onClick={() => addItem(v)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors text-left border-b border-slate-50 last:border-0">
                  <div className="w-10 h-10 rounded-lg bg-slate-100 overflow-hidden flex items-center justify-center flex-shrink-0">
                    {v.image ? <img src={v.image} alt="" className="w-full h-full object-cover" /> : <Package size={16} className="text-slate-300" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate">{v.title}</p>
                    <p className="text-[10px] text-slate-400">{v.variant_title} {v.sku && `· ${copy.sku}: ${v.sku}`}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-emerald-600">${v.price}</p>
                    <p className="text-[10px] text-slate-400">{v.inventory} {copy.inStock}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Selected Line Items */}
        {lineItems.length > 0 && (
          <div className="mt-4 space-y-2">
            {lineItems.map(li => (
              <div key={li.variant_id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold truncate">{li.title} - {li.variantTitle}</p>
                  <p className="text-[10px] text-slate-400">{li.sku && `${copy.sku}: ${li.sku} · `}${li.price} {copy.each}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => updateQty(li.variant_id, -1)} className="w-7 h-7 rounded-lg bg-white border border-slate-200 flex items-center justify-center hover:bg-slate-100"><Minus size={14}/></button>
                  <span className="w-8 text-center text-sm font-bold">{li.quantity}</span>
                  <button onClick={() => updateQty(li.variant_id, 1)} className="w-7 h-7 rounded-lg bg-white border border-slate-200 flex items-center justify-center hover:bg-slate-100"><Plus size={14}/></button>
                </div>
                <button onClick={() => removeItem(li.variant_id)} className="text-red-400 hover:text-red-600 p-1"><Trash2 size={16}/></button>
              </div>
            ))}
            <div className="flex justify-between items-center pt-3 border-t border-slate-100">
              <span className="text-sm font-bold text-slate-500">{copy.orderTotal}</span>
              <span className="text-lg font-black text-emerald-600">${orderTotal}</span>
            </div>
          </div>
        )}
      </section>

      {/* Customer Info */}
      <section className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm">
        <h3 className="text-[10px] font-bold uppercase text-slate-400 mb-4 tracking-widest flex items-center gap-2"><User size={14}/> {copy.customerDetails}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">{copy.fullName}</label>
            <input type="text" value={customerName} onChange={e => setCustomerName(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-500/30" placeholder="Ahmed Bennani" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">{copy.phone}</label>
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
              <Phone size={14} className="text-slate-400" />
              <input type="tel" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} className="bg-transparent flex-1 text-sm font-bold outline-none" placeholder="+212 600 000000" />
            </div>
          </div>
        </div>
        {/* Collapsible Address (pre-filled) */}
        <details className="mt-4">
          <summary className="text-[10px] font-bold text-slate-400 uppercase cursor-pointer hover:text-slate-600 flex items-center gap-1"><MapPin size={12}/> {copy.addressSummary}</summary>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">{copy.address}</label>
              <input type="text" value={address.address1} onChange={e => setAddress({...address, address1: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none" />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">{copy.city}</label>
              <input type="text" value={address.city} onChange={e => setAddress({...address, city: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none" />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">{copy.province}</label>
              <input type="text" value={address.province} onChange={e => setAddress({...address, province: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none" />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">{copy.zip}</label>
              <input type="text" value={address.zip} onChange={e => setAddress({...address, zip: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none" />
            </div>
          </div>
        </details>
      </section>

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={saving || lineItems.length === 0}
        className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white py-4 rounded-2xl font-bold shadow-xl shadow-emerald-200 transition-all active:scale-[0.98] disabled:opacity-60 flex items-center justify-center gap-3 text-base uppercase tracking-wider"
      >
        {saving && <Loader2 className="animate-spin" size={20} />}
        <ShoppingCart size={20} />
        {copy.placeOrder} ({lineItems.length} {copy.itemsLabel} · ${orderTotal})
      </button>
    </div>
  )
}

// ═══════════════════════════════════════════════════
//  SETTINGS TAB
// ═══════════════════════════════════════════════════
// ─── Orders Tab ──────────────────────────────────────────
function CreateOrderTabSimpleInvoice({ vendor, products, onDone, copy, lang }: { vendor: any; products: any[]; onDone: () => void; copy: AppCopy; lang: Lang }) {
  const [search, setSearch] = useState('')
  const [lineItems, setLineItems] = useState<{ variant_id: number; quantity: number; title: string; sku: string; price: string; image: string | null; variantTitle: string }[]>([])
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [address, setAddress] = useState<WholesaleAddressForm>(createDefaultWholesaleAddress)
  const [knownCustomers, setKnownCustomers] = useState<any[]>([])
  const [loadingCustomers, setLoadingCustomers] = useState(false)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState<any>(null)
  const [showProducts, setShowProducts] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)
  const invoiceRef = useRef<HTMLDivElement>(null)
  const isArabic = lang === 'ar'
  const locale = getLocale(lang)

  const allVariants = useMemo(() => {
    const arr: any[] = []
    products.forEach(p => {
      ;(p.variants || []).forEach((v: any) => {
        arr.push({
          variant_id: v.id,
          title: p.title,
          variant_title: v.title,
          sku: v.sku || '',
          price: v.price || '0.00',
          inventory: v.inventory_quantity || 0,
          image: p.images?.[0]?.src || null,
        })
      })
    })
    return arr
  }, [products])

  const filtered = useMemo(() => {
    if (!search) return allVariants.slice(0, 20)
    const q = search.toLowerCase()
    return allVariants.filter(v =>
      v.title.toLowerCase().includes(q) || v.sku.toLowerCase().includes(q) || v.variant_title.toLowerCase().includes(q)
    ).slice(0, 20)
  }, [allVariants, search])

  const matchedCustomer = useMemo(() => {
    const normalizedPhone = normalizeWholesalePhone(customerPhone)
    if (!normalizedPhone) return null
    return knownCustomers.find((customer: any) => {
      const candidate = customer.customer_phone_normalized || normalizeWholesalePhone(customer.customer_phone)
      return candidate === normalizedPhone
    }) || null
  }, [knownCustomers, customerPhone])

  function addItem(v: any) {
    const existing = lineItems.find(li => li.variant_id === v.variant_id)
    if (existing) {
      setLineItems(lineItems.map(li => li.variant_id === v.variant_id ? { ...li, quantity: li.quantity + 1 } : li))
    } else {
      setLineItems([...lineItems, { variant_id: v.variant_id, quantity: 1, title: v.title, sku: v.sku, price: v.price, image: v.image, variantTitle: v.variant_title }])
    }
    setSearch('')
    setShowProducts(false)
  }

  function updateQty(variantId: number, delta: number) {
    setLineItems(lineItems.map(li => li.variant_id === variantId ? { ...li, quantity: Math.max(1, li.quantity + delta) } : li))
  }

  function removeItem(variantId: number) {
    setLineItems(lineItems.filter(li => li.variant_id !== variantId))
  }

  const orderTotal = useMemo(() => lineItems.reduce((sum, li) => sum + toNumber(li.price) * li.quantity, 0).toFixed(2), [lineItems])

  async function handleSubmit() {
    if (!customerName.trim() || !customerPhone.trim()) { alert(copy.customerNamePhoneRequired); return }
    if (lineItems.length === 0) { alert(copy.addAtLeastOneProduct); return }
    setSaving(true)
    try {
      const body = {
        customer_name: customerName.trim(),
        customer_phone: customerPhone.trim(),
        customer_address1: address.address1,
        customer_city: address.city,
        customer_province: address.province,
        customer_zip: address.zip,
        customer_country: address.country,
        line_items: lineItems.map(li => ({ variant_id: li.variant_id, quantity: li.quantity })),
      }
      const res = await apiPost(`/api/wholesale/vendors/${vendor.id}/orders`, body)
      if (res?.error) { alert(`${copy.errorPrefix}: ${res.error}`); setSaving(false); return }
      setSuccess(res?.data)
    } catch (e: any) {
      alert(`${copy.failedPrefix}: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  async function downloadInvoice() {
    if (!invoiceRef.current) return
    try {
      const html2canvas = (await import('html2canvas')).default
      const canvas = await html2canvas(invoiceRef.current, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false })
      const link = document.createElement('a')
      link.download = `invoice-${success?.name || success?.order_number || 'order'}.png`
      link.href = canvas.toDataURL('image/png')
      link.click()
    } catch (err) {
      console.error('Failed to generate invoice image:', err)
      alert(copy.invoiceImageFailed)
    }
  }

  async function shareInvoice() {
    if (!invoiceRef.current) return
    try {
      const html2canvas = (await import('html2canvas')).default
      const canvas = await html2canvas(invoiceRef.current, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false })
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
      if (!blob) { downloadInvoice(); return }
      if (navigator.share && navigator.canShare) {
        const file = new File([blob], `invoice-${success?.name || 'order'}.png`, { type: 'image/png' })
        const shareData = { files: [file], title: `${copy.invoice} ${success?.name || ''}`, text: `${copy.invoice} ${vendor.name}` }
        if (navigator.canShare(shareData)) {
          await navigator.share(shareData)
          return
        }
      }
      downloadInvoice()
    } catch (err) {
      console.error('Share failed:', err)
      downloadInvoice()
    }
  }

  useEffect(() => {
    let active = true

    async function fetchCustomers() {
      setLoadingCustomers(true)
      try {
        const res = await apiGet(`/api/wholesale/vendors/${vendor.id}/customers`)
        if (active) setKnownCustomers(res?.data?.customers || [])
      } catch {
        if (active) setKnownCustomers([])
      } finally {
        if (active) setLoadingCustomers(false)
      }
    }

    fetchCustomers()
    return () => { active = false }
  }, [vendor.id])

  useEffect(() => {
    if (!matchedCustomer) return

    if (!customerName.trim() && matchedCustomer.customer_name) {
      setCustomerName(matchedCustomer.customer_name)
    }

    setAddress(prev => {
      const defaults = createDefaultWholesaleAddress()
      const next = { ...prev }
      let changed = false
      ;([
        ['address1', matchedCustomer.customer_address1],
        ['city', matchedCustomer.customer_city],
        ['province', matchedCustomer.customer_province],
        ['zip', matchedCustomer.customer_zip],
        ['country', matchedCustomer.customer_country],
      ] as const).forEach(([field, value]) => {
        const current = String(prev[field] || '').trim()
        const incoming = String(value || '').trim()
        const currentIsDefault = current === String(defaults[field] || '').trim()
        if (incoming && (!current || currentIsDefault)) {
          next[field] = incoming
          changed = true
        }
      })
      return changed ? next : prev
    })
  }, [matchedCustomer, customerName])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setShowProducts(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const invoiceDate = new Date().toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' })
  const invoiceTime = new Date().toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  const totalItems = lineItems.reduce((sum, li) => sum + li.quantity, 0)
  const invoiceNumber = success?.name || `#${success?.order_number || ''}`
  const invoiceTotal = toNumber(success?.total_price || orderTotal)
  const customerAddressLine = address.address1 && address.address1 !== 'NA' ? address.address1 : null
  const invoiceFontFamily = isArabic
    ? "'Geeza Pro', 'Tahoma', 'Arial', 'Noto Sans Arabic', sans-serif"
    : "'Georgia', 'Times New Roman', serif"
  const invoiceLabelClass = isArabic
    ? 'text-sm font-extrabold text-slate-600 leading-6'
    : 'text-xs font-semibold uppercase tracking-[0.18em] text-slate-400'
  const invoiceMetaLabelClass = isArabic
    ? 'text-sm font-extrabold text-slate-600 leading-6'
    : 'text-xs font-semibold uppercase tracking-[0.16em] text-slate-500'
  const invoiceBodyTextClass = isArabic
    ? 'text-lg font-bold text-slate-900 leading-8'
    : 'text-sm font-semibold text-slate-900'
  const invoiceMutedTextClass = isArabic
    ? 'text-base font-semibold text-slate-600 leading-7'
    : 'text-sm text-slate-500'
  const invoiceSmallMutedTextClass = isArabic
    ? 'text-sm font-semibold text-slate-500 leading-6'
    : 'text-xs text-slate-500'
  const invoiceTableHeadClass = isArabic
    ? 'px-3 py-4 text-sm font-extrabold text-white'
    : 'px-3 py-3 text-xs font-bold uppercase tracking-[0.16em]'
  const invoiceTableCellClass = isArabic
    ? 'px-3 py-4 text-base font-bold text-slate-800'
    : 'px-3 py-4 text-sm font-semibold text-slate-700'
  const totalToPayLabel = isArabic ? 'المبلغ الواجب دفعه' : 'Total to pay'

  if (success) {
    return (
      <div className="max-w-3xl mx-auto space-y-4 pb-24 animate-in">
        <div className="grid grid-cols-2 gap-2">
          <button onClick={downloadInvoice} className="flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white py-2.5 rounded-2xl font-bold shadow-lg shadow-blue-200 transition-all active:scale-[0.98] text-xs sm:text-sm">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            {copy.downloadInvoice}
          </button>
          <button onClick={shareInvoice} className="flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white py-2.5 rounded-2xl font-bold shadow-lg shadow-emerald-200 transition-all active:scale-[0.98] text-xs sm:text-sm">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
            {copy.shareInvoice}
          </button>
        </div>

        <div ref={invoiceRef} dir={isArabic ? 'rtl' : 'ltr'} lang={isArabic ? 'ar' : 'en'} className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.08)]" style={{ fontFamily: invoiceFontFamily }}>
          <div className="grid min-h-[920px] grid-rows-[minmax(210px,1fr)_minmax(420px,2fr)_minmax(210px,1fr)]">
            <section className="grid gap-5 border-b border-slate-200 px-5 py-6 md:grid-cols-[1.2fr_0.8fr] md:px-8">
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-900 text-white">
                    <FileText size={18} />
                  </div>
                  <div>
                    <p className="text-xl font-bold tracking-tight text-slate-950">{copy.brand}</p>
                    <p className={`mt-1 ${invoiceMutedTextClass}`}>{vendor.name}</p>
                    <p className={`mt-3 ${invoiceLabelClass}`}>{copy.invoice}</p>
                    <p className={`mt-1 ${isArabic ? 'text-3xl font-extrabold text-slate-950' : 'text-2xl font-bold text-slate-950'}`}>{invoiceNumber}</p>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1 rounded-2xl border border-slate-200 px-4 py-3">
                    <p className={invoiceLabelClass}>{copy.billFrom}</p>
                    <p className={invoiceBodyTextClass}>{vendor.name}</p>
                    <p className={invoiceMutedTextClass}>MMD Wholesale</p>
                    <p className={invoiceMutedTextClass}>Casablanca, Morocco</p>
                  </div>
                  <div className="space-y-1 rounded-2xl border border-slate-200 px-4 py-3">
                    <p className={invoiceLabelClass}>{copy.billTo}</p>
                    <p className={`${invoiceBodyTextClass} break-words`}>{customerName}</p>
                    <p className={`${invoiceMutedTextClass} break-words`}>{customerPhone}</p>
                    {customerAddressLine && <p className={`${invoiceMutedTextClass} break-words`}>{customerAddressLine}</p>}
                  </div>
                </div>
              </div>

              <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-5 py-4">
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-3">
                    <span className={invoiceMetaLabelClass}>{copy.issueDate}</span>
                    <span className={invoiceBodyTextClass}>{invoiceDate}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-3">
                    <span className={invoiceMetaLabelClass}>{copy.time}</span>
                    <span className={invoiceBodyTextClass}>{invoiceTime}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className={invoiceMetaLabelClass}>{copy.status}</span>
                    <span className={`rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 ${isArabic ? 'text-base font-extrabold' : 'text-sm font-bold'} text-emerald-700`}>{copy.confirmed}</span>
                  </div>
                </div>
              </div>
            </section>

            <section className="px-5 py-5 md:px-8">
              <div className="h-full overflow-hidden rounded-[22px] border border-slate-200">
                <table className="w-full border-collapse table-fixed">
                  <colgroup>
                    <col className="w-[10%]" />
                    <col className="w-[46%]" />
                    <col className="w-[12%]" />
                    <col className="w-[16%]" />
                    <col className="w-[16%]" />
                  </colgroup>
                  <thead className="bg-slate-800 text-white">
                    <tr>
                      <th className={invoiceTableHeadClass}>#</th>
                      <th className={invoiceTableHeadClass}>{copy.itemColumn}</th>
                      <th className={invoiceTableHeadClass}>{copy.qty}</th>
                      <th className={invoiceTableHeadClass}>{copy.unitPrice}</th>
                      <th className={invoiceTableHeadClass}>{copy.lineTotal}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineItems.map((li, index) => (
                      <tr key={li.variant_id} className="align-top border-b border-slate-200 last:border-b-0">
                        <td className={`${invoiceTableCellClass} text-center ${isArabic ? 'text-base' : 'text-sm'} text-slate-500`}>{index + 1}</td>
                        <td className="px-3 py-4">
                          <p className={`${isArabic ? 'text-base font-extrabold leading-8' : 'text-sm font-semibold'} text-slate-900 break-words`}>{li.title}</p>
                          <p className={`mt-1 ${invoiceSmallMutedTextClass} break-words`}>
                            {li.variantTitle !== 'Default Title' ? li.variantTitle : li.sku || '-'}
                            {li.sku ? ` · ${copy.sku}: ${li.sku}` : ''}
                          </p>
                        </td>
                        <td className={`${invoiceTableCellClass} text-center`}>{li.quantity}</td>
                        <td className={`${invoiceTableCellClass} text-right`}>{formatDh(li.price, locale)}</td>
                        <td className={`${invoiceTableCellClass} text-right text-slate-900`}>{formatDh(toNumber(li.price) * li.quantity, locale)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="grid gap-5 border-t border-slate-200 px-5 py-6 md:grid-cols-[1fr_320px] md:px-8">
              <div className="rounded-[22px] border border-slate-200 px-5 py-4">
                <p className={invoiceLabelClass}>{copy.paymentNote}</p>
                <p className={`mt-4 ${invoiceMutedTextClass}`}>{copy.thankYou}</p>
                <p className={`mt-3 ${invoiceSmallMutedTextClass}`}>{totalItems} {copy.itemsLabel}</p>
              </div>

              <div className="rounded-[22px] border border-slate-200 bg-slate-50 px-5 py-4">
                <div className={`space-y-3 ${isArabic ? 'text-base' : 'text-sm'}`}>
                  <div className={`flex items-center justify-between gap-3 ${isArabic ? 'font-bold text-slate-700' : 'text-slate-600'}`}>
                    <span>{copy.subtotal}</span>
                    <span className={`${isArabic ? 'text-lg font-extrabold' : 'font-semibold'} text-slate-900`}>{formatDh(orderTotal, locale)}</span>
                  </div>
                  <div className={`flex items-center justify-between gap-3 ${isArabic ? 'font-bold text-slate-700' : 'text-slate-600'}`}>
                    <span>{copy.shipping}</span>
                    <span className={`${isArabic ? 'text-lg font-extrabold' : 'font-semibold'} text-slate-900`}>{copy.free}</span>
                  </div>
                </div>

                <div className="mt-5 rounded-[20px] border-2 border-slate-900 bg-white px-5 py-4">
                  <p className={invoiceLabelClass}>{copy.total}</p>
                  <div className="mt-2 flex items-end justify-between gap-4">
                    <div>
                      <p className={`${isArabic ? 'text-lg font-extrabold leading-8' : 'text-sm font-semibold'} text-slate-900`}>{totalToPayLabel}</p>
                      <p className={`mt-1 ${invoiceSmallMutedTextClass}`}>{invoiceDate}</p>
                    </div>
                    <p className={`${isArabic ? 'text-[2.4rem] font-extrabold leading-none' : 'text-3xl font-bold tracking-tight'} text-slate-950`}>{formatDh(invoiceTotal, locale)}</p>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button onClick={() => { setSuccess(null); setLineItems([]); setCustomerName(''); setCustomerPhone(''); setAddress(createDefaultWholesaleAddress()) }} className="px-6 py-3 bg-white border border-slate-200 rounded-xl font-bold text-sm hover:bg-slate-50">
            {copy.newOrder}
          </button>
          <button onClick={onDone} className="px-6 py-3 bg-emerald-600 text-white rounded-xl font-bold text-sm hover:bg-emerald-700">
            {copy.backToOverview}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-28 animate-in">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
          <div className="p-2 bg-emerald-100 rounded-xl"><ShoppingCart size={22} className="text-emerald-600" /></div>
          {copy.createOrderTitle}
        </h2>
        <p className="text-slate-500 text-sm mt-1">{copy.createOrderSub}</p>
      </div>

      <section className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm">
        <h3 className="text-[10px] font-bold uppercase text-slate-400 mb-4 tracking-widest">{copy.addProducts}</h3>
        <div ref={searchRef} className="relative">
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
            <Search size={16} className="text-slate-400" />
            <input type="text" value={search} onChange={e => { setSearch(e.target.value); setShowProducts(true) }} onFocus={() => setShowProducts(true)} placeholder={copy.searchByProductOrSku} className="bg-transparent flex-1 text-sm font-medium outline-none" />
          </div>
          {showProducts && (
            <div className="absolute z-40 left-0 right-0 mt-2 bg-white border border-slate-200 rounded-2xl shadow-xl max-h-64 overflow-y-auto">
              {filtered.length === 0 && <p className="p-4 text-sm text-slate-400 text-center">{copy.noProductsFound}</p>}
              {filtered.map(v => (
                <button key={v.variant_id} onClick={() => addItem(v)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors text-left border-b border-slate-50 last:border-0">
                  <div className="w-10 h-10 rounded-lg bg-slate-100 overflow-hidden flex items-center justify-center flex-shrink-0">
                    {v.image ? <img src={v.image} alt="" className="w-full h-full object-cover" /> : <Package size={16} className="text-slate-300" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate">{v.title}</p>
                    <p className="text-[10px] text-slate-400">{v.variant_title} {v.sku && `· ${copy.sku}: ${v.sku}`}</p>
                  </div>
                  <div className={`${isArabic ? 'text-left' : 'text-right'} flex-shrink-0`}>
                    <p className="text-sm font-bold text-emerald-600">{formatDh(v.price, locale)}</p>
                    <p className="text-[10px] text-slate-400">{v.inventory} {copy.inStock}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {lineItems.length > 0 && (
          <div className="mt-4 space-y-2">
            {lineItems.map(li => (
              <div key={li.variant_id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold truncate">{li.title} - {li.variantTitle}</p>
                  <p className="text-[10px] text-slate-400">{li.sku && `${copy.sku}: ${li.sku} · `}{formatDh(li.price, locale)} {copy.each}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => updateQty(li.variant_id, -1)} className="w-7 h-7 rounded-lg bg-white border border-slate-200 flex items-center justify-center hover:bg-slate-100"><Minus size={14}/></button>
                  <span className="w-8 text-center text-sm font-bold">{li.quantity}</span>
                  <button onClick={() => updateQty(li.variant_id, 1)} className="w-7 h-7 rounded-lg bg-white border border-slate-200 flex items-center justify-center hover:bg-slate-100"><Plus size={14}/></button>
                </div>
                <button onClick={() => removeItem(li.variant_id)} className="text-red-400 hover:text-red-600 p-1"><Trash2 size={16}/></button>
              </div>
            ))}
            <div className="flex justify-between items-center pt-3 border-t border-slate-100">
              <span className="text-sm font-bold text-slate-500">{copy.orderTotal}</span>
              <span className="text-lg font-black text-emerald-600">{formatDh(orderTotal, locale)}</span>
            </div>
          </div>
        )}
      </section>

      <section className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm">
        <h3 className="text-[10px] font-bold uppercase text-slate-400 mb-4 tracking-widest flex items-center gap-2"><User size={14}/> {copy.customerDetails}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">{copy.fullName}</label>
            <input type="text" value={customerName} onChange={e => setCustomerName(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-500/30" placeholder="Ahmed Bennani" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">{copy.phone}</label>
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
              <Phone size={14} className="text-slate-400" />
              <input type="tel" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} className="bg-transparent flex-1 text-sm font-bold outline-none" placeholder="+212 600 000000" />
            </div>
          </div>
        </div>
        {loadingCustomers ? (
          <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
            <Loader2 size={14} className="animate-spin" />
            <span>{lang === 'ar' ? 'جارٍ التحقق من العملاء الحاليين...' : 'Checking existing customers...'}</span>
          </div>
        ) : matchedCustomer ? (
          <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <div className="flex items-start gap-3">
              <AlertCircle size={16} className="mt-0.5 text-emerald-600" />
              <div className="min-w-0">
                <p className="text-sm font-bold text-emerald-800">
                  {lang === 'ar' ? 'تم العثور على عميل موجود لهذا الرقم.' : 'Existing customer found for this phone number.'}
                </p>
                <p className="mt-1 text-xs text-emerald-700 break-words">
                  {matchedCustomer.customer_name} · {matchedCustomer.orders_count} {copy.ordersCountLabel}
                </p>
              </div>
            </div>
          </div>
        ) : null}
        <details className="mt-4">
          <summary className="text-[10px] font-bold text-slate-400 uppercase cursor-pointer hover:text-slate-600 flex items-center gap-1"><MapPin size={12}/> {copy.addressSummary}</summary>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">{copy.address}</label>
              <input type="text" value={address.address1} onChange={e => setAddress({...address, address1: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none" />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">{copy.city}</label>
              <input type="text" value={address.city} onChange={e => setAddress({...address, city: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none" />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">{copy.province}</label>
              <input type="text" value={address.province} onChange={e => setAddress({...address, province: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none" />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">{copy.zip}</label>
              <input type="text" value={address.zip} onChange={e => setAddress({...address, zip: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none" />
            </div>
          </div>
        </details>
      </section>

      <button onClick={handleSubmit} disabled={saving || lineItems.length === 0} className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white py-4 rounded-2xl font-bold shadow-xl shadow-emerald-200 transition-all active:scale-[0.98] disabled:opacity-60 flex items-center justify-center gap-3 text-base uppercase tracking-wider">
        {saving && <Loader2 className="animate-spin" size={20} />}
        <ShoppingCart size={20} />
        {copy.placeOrder} ({lineItems.length} {copy.itemsLabel} · {formatDh(orderTotal, locale)})
      </button>
    </div>
  )
}

function OrdersTab({ vendor, copy, lang }: { vendor: any; copy: AppCopy; lang: Lang }) {
  const [orders, setOrders] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'unpaid'|'newest'|'oldest'>('unpaid')
  const [customerFilter, setCustomerFilter] = useState('')
  const [expandedOrder, setExpandedOrder] = useState<string|null>(null)
  const [paymentModal, setPaymentModal] = useState<any>(null)
  const [payStatus, setPayStatus] = useState('unpaid')
  const [payAmount, setPayAmount] = useState('')
  const [payNote, setPayNote] = useState('')
  const [saving, setSaving] = useState(false)
  const isArabic = lang === 'ar'
  const locale = getLocale(lang)

  async function fetchOrders() {
    setLoading(true)
    try {
      const res = await apiGet(`/api/wholesale/vendors/${vendor.id}/orders`)
      setOrders(res?.data?.all_orders || [])
    } catch { setOrders([]) }
    finally { setLoading(false) }
  }
  useEffect(() => { fetchOrders() }, [vendor.id])

  // Unique customer names for filter
  const customers = useMemo(() => {
    const names = new Set(orders.map((o: any) => o.customer_name).filter(Boolean))
    return Array.from(names).sort()
  }, [orders])

  // Filtered + sorted
  const filtered = useMemo(() => {
    let list = [...orders]
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter((o: any) =>
        (o.name || '').toLowerCase().includes(q) ||
        (o.customer_name || '').toLowerCase().includes(q) ||
        (o.line_items || []).some((li: any) => (li.title || '').toLowerCase().includes(q))
      )
    }
    if (customerFilter) {
      list = list.filter((o: any) => o.customer_name === customerFilter)
    }
    if (sortBy === 'unpaid') {
      const priority: Record<string, number> = { unpaid: 0, partially_paid: 1, paid: 2 }
      list.sort((a: any, b: any) => {
        const pa = priority[a.payment_status] ?? 0
        const pb = priority[b.payment_status] ?? 0
        if (pa !== pb) return pa - pb
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      })
    } else if (sortBy === 'newest') {
      list.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    } else {
      list.sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    }
    return list
  }, [orders, search, customerFilter, sortBy])

  function openPaymentModal(order: any) {
    setPaymentModal(order)
    setPayStatus(order.payment_status || 'unpaid')
    setPayAmount(String(order.amount_paid || 0))
    setPayNote(order.payment_note || '')
  }

  async function savePayment() {
    if (!paymentModal) return
    setSaving(true)
    try {
      await apiPatch(`/api/wholesale/vendors/${vendor.id}/orders/${paymentModal.id}/payment`, {
        payment_status: payStatus,
        amount_paid: parseFloat(payAmount) || 0,
        payment_note: payNote,
      })
      // Update local state
      setOrders(prev => prev.map(o =>
        o.id === paymentModal.id ? { ...o, payment_status: payStatus, amount_paid: parseFloat(payAmount) || 0, payment_note: payNote } : o
      ))
      setPaymentModal(null)
    } catch { /* ignore */ }
    finally { setSaving(false) }
  }

  const statusBadge = (status: string) => {
    if (status === 'paid') return <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 text-[11px] font-bold rounded-full">✓ Paid</span>
    if (status === 'partially_paid') return <span className="px-2.5 py-1 bg-amber-100 text-amber-700 text-[11px] font-bold rounded-full">◐ Partial</span>
    return <span className="px-2.5 py-1 bg-red-100 text-red-600 text-[11px] font-bold rounded-full">● Unpaid</span>
  }

  const orderStatusBadge = (status: string) => {
    if (status === 'paid') return <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 text-[11px] font-bold rounded-full">✓ {copy.paid}</span>
    if (status === 'partially_paid') return <span className="px-2.5 py-1 bg-amber-100 text-amber-700 text-[11px] font-bold rounded-full">◐ {copy.partial}</span>
    return <span className="px-2.5 py-1 bg-red-100 text-red-600 text-[11px] font-bold rounded-full">● {copy.unpaid}</span>
  }

  const _unusedOrderStatusBadgeA = (status: string) => {
    if (status === 'paid') return <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 text-[11px] font-bold rounded-full">✓ {copy.paid}</span>
    if (status === 'partially_paid') return <span className="px-2.5 py-1 bg-amber-100 text-amber-700 text-[11px] font-bold rounded-full">◐ {copy.partial}</span>
    return <span className="px-2.5 py-1 bg-red-100 text-red-600 text-[11px] font-bold rounded-full">● {copy.unpaid}</span>
  }

  const _unusedOrderStatusBadgeB = (status: string) => {
    if (status === 'paid') return <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 text-[11px] font-bold rounded-full">✓ {copy.paid}</span>
    if (status === 'partially_paid') return <span className="px-2.5 py-1 bg-amber-100 text-amber-700 text-[11px] font-bold rounded-full">◐ {copy.partial}</span>
    return <span className="px-2.5 py-1 bg-red-100 text-red-600 text-[11px] font-bold rounded-full">● {copy.unpaid}</span>
  }

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="animate-spin text-blue-600" size={32} />
    </div>
  )

  return (
    <div className="max-w-4xl mx-auto space-y-4 pb-24 animate-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">{copy.ordersTitle}</h2>
          <p className="text-sm text-slate-500">{orders.length} {copy.totalOrdersLabel}</p>
        </div>
        <button onClick={fetchOrders} className="p-2.5 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors">
          <RefreshCw size={18} className="text-slate-500" />
        </button>
      </div>

      {/* Search + Filters */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
        <div className="relative">
          <Search className={`absolute top-1/2 -translate-y-1/2 text-slate-400 ${isArabic ? 'right-3' : 'left-3'}`} size={18} />
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder={copy.searchOrders}
            className={`w-full py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${isArabic ? 'pr-10 pl-4' : 'pl-10 pr-4'}`}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <select value={customerFilter} onChange={e => setCustomerFilter(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">{copy.allCustomers}</option>
            {customers.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <div className="flex bg-slate-100 rounded-xl p-0.5">
            {(['unpaid', 'newest', 'oldest'] as const).map(s => (
              <button key={s} onClick={() => setSortBy(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${sortBy === s ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                {s === 'unpaid' ? copy.unpaidFirst : s === 'newest' ? copy.newest : copy.oldest}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Orders List */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <ClipboardList size={48} className="mx-auto mb-4 opacity-40" />
          <p className="font-semibold">{copy.noOrdersFound}</p>
          <p className="text-sm mt-1">{copy.adjustSearchOrFilters}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((order: any) => {
            const isExpanded = expandedOrder === String(order.id)
            const total = parseFloat(order.total_price || '0')
            const remaining = total - (order.amount_paid || 0)
            return (
              <div key={order.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden hover:shadow-md transition-shadow">
                {/* Order Header */}
                <button onClick={() => setExpandedOrder(isExpanded ? null : String(order.id))}
                  className="w-full p-4 flex items-center gap-3 text-left">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm text-blue-600">{order.name}</span>
                      {orderStatusBadge(order.payment_status)}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      {order.customer_name} · {order.units} {copy.itemsLabel} · {new Date(order.created_at).toLocaleDateString(locale)}
                    </p>
                    <p className="hidden text-xs text-slate-500 mt-1">
                      {order.customer_name} · {order.units} items · {new Date(order.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-bold text-sm">{formatDh(total, locale)}</p>
                    {order.payment_status === 'partially_paid' && (
                      <p className="text-[10px] text-amber-600 font-medium">{copy.remaining}: {formatDh(remaining, locale)}</p>
                    )}
                  </div>
                  <ChevronRight size={16} className={`text-slate-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                </button>

                {/* Expanded Content */}
                {isExpanded && (
                  <div className="border-t border-slate-100 p-4 space-y-3 bg-slate-50/50">
                    {/* Line Items */}
                    <div className="space-y-2">
                      {(order.line_items || []).map((li: any, i: number) => (
                        <div key={i} className="flex items-center justify-between bg-white rounded-xl p-3 border border-slate-100">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold truncate">{li.title}</p>
                            <p className="text-[11px] text-slate-500">
                              {li.variant_title && <span>{li.variant_title} · </span>}
                              {li.sku && <span>{copy.sku}: {li.sku} · </span>}
                              {copy.qty}: {li.quantity}
                            </p>
                            <p className="hidden text-[11px] text-slate-500">
                              {li.variant_title && <span>{li.variant_title} · </span>}
                              {li.sku && <span>SKU: {li.sku} · </span>}
                              Qty: {li.quantity}
                            </p>
                          </div>
                          <p className="text-sm font-bold text-slate-700 ml-3">{formatDh(parseFloat(li.price) * li.quantity, locale)}</p>
                        </div>
                      ))}
                    </div>

                    {/* Payment Note */}
                    {order.payment_note && (
                      <div className="bg-amber-50 border border-amber-100 rounded-xl p-3">
                        <p className="text-[10px] font-bold text-amber-600 uppercase">{copy.paymentNote}</p>
                        <p className="text-sm text-amber-800 mt-0.5">{order.payment_note}</p>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex gap-2">
                      <button onClick={() => openPaymentModal(order)}
                        className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-blue-600 text-white text-sm font-bold rounded-xl hover:bg-blue-700 transition-colors">
                        <CreditCard size={16} /> {copy.updatePayment}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Payment Modal */}
      {paymentModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={() => setPaymentModal(null)}>
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-slate-100">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold">{copy.updatePayment}</h3>
                <button onClick={() => setPaymentModal(null)} className="p-1.5 hover:bg-slate-100 rounded-lg">
                  <X size={18} />
                </button>
              </div>
              <p className="text-sm text-slate-500 mt-1">{paymentModal.name} · {paymentModal.customer_name}</p>
              <p className="text-lg font-bold mt-2">{copy.total}: {formatDh(paymentModal.total_price || '0', locale)}</p>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase block mb-2">{copy.paymentStatus}</label>
                <div className="flex gap-2">
                  {[{v:'unpaid',l:copy.unpaid,c:'red'},{v:'partially_paid',l:copy.partial,c:'amber'},{v:'paid',l:copy.paid,c:'emerald'}].map(s => (
                    <button key={s.v} onClick={() => {
                      setPayStatus(s.v)
                      if (s.v === 'paid') setPayAmount(String(parseFloat(paymentModal.total_price || '0')))
                      if (s.v === 'unpaid') setPayAmount('0')
                    }}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all border-2 ${
                        payStatus === s.v
                          ? s.c === 'red' ? 'border-red-500 bg-red-50 text-red-600'
                          : s.c === 'amber' ? 'border-amber-500 bg-amber-50 text-amber-600'
                          : 'border-emerald-500 bg-emerald-50 text-emerald-600'
                          : 'border-slate-200 text-slate-500 hover:border-slate-300'
                      }`}>
                      {s.l}
                    </button>
                  ))}
                </div>
              </div>
              {payStatus !== 'unpaid' && (
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase block mb-2">{copy.amountPaid}</label>
                  <input type="number" value={payAmount} onChange={e => setPayAmount(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="0.00" step="0.01" />
                </div>
              )}
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase block mb-2">{copy.noteOptional}</label>
                <textarea value={payNote} onChange={e => setPayNote(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  rows={2} placeholder={copy.anyPaymentNotes} />
              </div>
            </div>
            <div className="p-6 border-t border-slate-100 flex gap-3">
              <button onClick={() => setPaymentModal(null)} className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-colors text-sm">
                {copy.cancel}
              </button>
              <button onClick={savePayment} disabled={saving}
                className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-colors text-sm disabled:opacity-50 flex items-center justify-center gap-2">
                {saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
                {copy.save}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Customers Tab ───────────────────────────────────────
function CustomersTab({ vendor, copy, lang }: { vendor: any; copy: AppCopy; lang: Lang }) {
  const [loading, setLoading] = useState(true)
  const [customers, setCustomers] = useState<any[]>([])
  const [totalUnpaid, setTotalUnpaid] = useState(0)
  const [search, setSearch] = useState('')
  const [selectedCustomerKey, setSelectedCustomerKey] = useState('')
  const isArabic = lang === 'ar'
  const locale = isArabic ? 'ar-MA' : 'en-GB'

  async function fetchCustomers() {
    setLoading(true)
    try {
      const res = await apiGet(`/api/wholesale/vendors/${vendor.id}/customers`)
      const list = res?.data?.customers || []
      setCustomers(list)
      setTotalUnpaid(Number(res?.data?.total_unpaid || 0))
      setSelectedCustomerKey((prev: string) => {
        if (prev && list.some((c: any) => c.key === prev)) return prev
        return list[0]?.key || ''
      })
    } catch {
      setCustomers([])
      setTotalUnpaid(0)
      setSelectedCustomerKey('')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchCustomers() }, [vendor.id])

  const filteredCustomers = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return customers
    return customers.filter((c: any) =>
      (c.customer_name || '').toLowerCase().includes(q) ||
      (c.customer_phone || '').toLowerCase().includes(q)
    )
  }, [customers, search])

  const selectedCustomer = useMemo(
    () => filteredCustomers.find((c: any) => c.key === selectedCustomerKey) || null,
    [filteredCustomers, selectedCustomerKey]
  )

  const localizedStatusBadge = (status: string) => {
    if (status === 'paid') return <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 text-[11px] font-bold rounded-full">✓ {copy.paid}</span>
    if (status === 'partially_paid') return <span className="px-2.5 py-1 bg-amber-100 text-amber-700 text-[11px] font-bold rounded-full">◐ {copy.partial}</span>
    return <span className="px-2.5 py-1 bg-red-100 text-red-600 text-[11px] font-bold rounded-full">● {copy.unpaid}</span>
  }

  const statusBadge = (status: string) => {
    if (status === 'paid') return <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 text-[11px] font-bold rounded-full">✓ Paid</span>
    if (status === 'partially_paid') return <span className="px-2.5 py-1 bg-amber-100 text-amber-700 text-[11px] font-bold rounded-full">◐ Partial</span>
    return <span className="px-2.5 py-1 bg-red-100 text-red-600 text-[11px] font-bold rounded-full">● Unpaid</span>
  }

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="animate-spin text-blue-600" size={32} />
    </div>
  )

  return (
    <div className="max-w-6xl mx-auto space-y-4 pb-24 animate-in">
      <div className="flex items-center justify-between">
        <div className="[&>p:last-of-type]:hidden">
          <h2 className="text-2xl font-bold">{copy.customersTitle}</h2>
          <p className="text-sm text-slate-500">{customers.length} {copy.taggedCustomersLabel} · {formatDh(totalUnpaid, locale)} {copy.unpaidLabel}</p>
          <p className="text-sm text-slate-500">{customers.length} tagged customers · {formatDh(totalUnpaid, locale)} unpaid</p>
        </div>
        <button onClick={fetchCustomers} className="p-2.5 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors">
          <RefreshCw size={18} className="text-slate-500" />
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <div className="relative">
          <Search className={`absolute top-1/2 -translate-y-1/2 text-slate-400 ${isArabic ? 'right-3' : 'left-3'}`} size={18} />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={copy.searchCustomers}
            className={`w-full py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${isArabic ? 'pr-10 pl-4' : 'pl-10 pr-4'}`}
          />
        </div>
      </div>

      {filteredCustomers.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <Users size={48} className="mx-auto mb-4 opacity-40" />
          <p className="font-semibold">{lang === 'ar' ? 'لم يتم العثور على عملاء' : 'No customers found'}</p>
          <p className="text-sm mt-1">{copy.adjustSearch}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4">
          <div className="space-y-2">
            {filteredCustomers.map((c: any) => {
              const selected = c.key === selectedCustomerKey
              return (
                <button
                  key={c.key}
                  onClick={() => setSelectedCustomerKey(c.key)}
                  className={`w-full text-left rounded-2xl border p-4 transition-all ${
                    selected ? 'bg-blue-50 border-blue-200 shadow-sm' : 'bg-white border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-bold text-sm truncate">{c.customer_name || copy.notAvailable}</p>
                      <p className="text-[11px] text-slate-500 truncate">{c.customer_phone || copy.noPhone}</p>
                    </div>
                    <span className="text-[11px] font-semibold px-2 py-1 rounded-full bg-slate-100 text-slate-600">
                      {c.orders_count} {copy.ordersCountLabel}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs">
                    <span className="text-slate-500">{copy.pending}</span>
                    <span className={`font-bold ${Number(c.total_unpaid || 0) > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                      {formatDh(Number(c.total_unpaid || 0), locale)}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-4">
            {!selectedCustomer ? (
              <div className="text-center py-16 text-slate-400">
                <p className="font-semibold">{copy.selectCustomer}</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="text-lg font-bold">{selectedCustomer.customer_name || copy.notAvailable}</h3>
                    <p className="text-sm text-slate-500">{selectedCustomer.customer_phone || copy.noPhone}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] text-slate-500">{copy.unpaidTotal}</p>
                    <p className={`text-lg font-bold ${Number(selectedCustomer.total_unpaid || 0) > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                      {formatDh(Number(selectedCustomer.total_unpaid || 0), locale)}
                    </p>
                  </div>
                </div>

                {(selectedCustomer.orders || []).length === 0 ? (
                  <p className="text-sm text-slate-500">{copy.noOrdersForCustomer}</p>
                ) : (
                  <div className="space-y-2">
                    {(selectedCustomer.orders || []).map((o: any) => {
                      const total = Number(o.total_price || 0)
                      const paid = Number(o.amount_paid || 0)
                      const pending = Number(o.pending_amount || 0)
                      return (
                        <div key={o.id} className="rounded-xl border border-slate-200 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-bold text-sm text-blue-600">{o.name || `#${o.id}`}</p>
                              <p className="text-[11px] text-slate-500">{o.created_at ? new Date(o.created_at).toLocaleString(locale) : ''}</p>
                            </div>
                            {localizedStatusBadge(o.payment_status)}
                          </div>
                          <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                            <div className="rounded-lg bg-slate-50 p-2 border border-slate-100">
                              <p className="text-slate-500">{copy.total}</p>
                              <p className="font-bold text-slate-700">{total.toFixed(2)}</p>
                            </div>
                            <div className="rounded-lg bg-emerald-50 p-2 border border-emerald-100">
                              <p className="text-emerald-700">{copy.paid}</p>
                              <p className="font-bold text-emerald-700">{paid.toFixed(2)}</p>
                            </div>
                            <div className="rounded-lg bg-red-50 p-2 border border-red-100">
                              <p className="text-red-600">{copy.pending}</p>
                              <p className="font-bold text-red-600">{pending.toFixed(2)}</p>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
