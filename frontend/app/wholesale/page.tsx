"use client"

import { useState, useEffect, useMemo, useRef } from 'react'
import Link from 'next/link'
import {
  LayoutDashboard, PlusCircle, Package, Camera, Settings, Trash2, Plus, Loader2,
  TrendingUp, Box, DollarSign, Tag as TagIcon, RefreshCw, Image as ImageIcon,
  Filter, ChevronDown, Calendar, Clock, Layers, X, LogOut, User, Eye, EyeOff,
  ShoppingCart, CheckCircle, Minus, Search, Phone, MapPin, ClipboardList, FileText,
  CreditCard, AlertCircle, ChevronRight, Edit3, Users, BarChart3, Share2
} from 'lucide-react'

const API = process.env.NEXT_PUBLIC_API_BASE_URL || ''
const SEGMENTS = ['Men', 'Women', 'Kids']
const SEASONS = ['Winter', 'Summer', 'Spring', 'Fall']
type Lang = 'en' | 'ar'
type StockVariantFormRow = {
  from: number | string
  to: number | string
  pcsPerCrate: number | string
  crateQty: number | string
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
  return { from: '', to: '', pcsPerCrate: '', crateQty: '', sku: '' }
}

function getLocale(lang: Lang) {
  return lang === 'ar' ? 'ar-MA' : 'en-GB'
}

function toNumber(value: number | string | null | undefined) {
  const parsed = typeof value === 'number' ? value : parseFloat(String(value ?? '0'))
  return Number.isFinite(parsed) ? parsed : 0
}

function toInteger(value: number | string | null | undefined) {
  const parsed = parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatDh(value: number | string | null | undefined, locale = 'en-GB') {
  const amount = toNumber(value)
  return `${amount.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`
}

function getVariantAvailable(variant: any) {
  return Math.max(0, parseInt(String(variant?.inventory_available ?? variant?.available_quantity ?? variant?.inventory_quantity ?? 0), 10) || 0)
}

function getVariantOnHand(variant: any) {
  return Math.max(0, parseInt(String(variant?.inventory_on_hand ?? variant?.inventory_quantity ?? getVariantAvailable(variant)), 10) || 0)
}

function buildVariantTitle(group: Pick<StockVariantFormRow, 'from' | 'to' | 'pcsPerCrate'>) {
  const from = String(group.from || '').trim() || '36'
  const to = String(group.to || '').trim() || '40'
  const pcs = toInteger(group.pcsPerCrate)
  const range = `${from}-${to}`
  return pcs > 0 ? `${range}*${pcs}pcs` : range
}

function getVariantCratePrice(unitSalePrice: number, group: Pick<StockVariantFormRow, 'pcsPerCrate'>) {
  return unitSalePrice * Math.max(0, toInteger(group.pcsPerCrate))
}

function getDisplaySize(value: string | null | undefined) {
  const raw = String(value || '').trim()
  if (!raw || raw.toLowerCase() === 'default title') return '-'
  return raw.split(' / ')[0]?.trim() || raw
}

function getDisplaySku(value: string | null | undefined) {
  const raw = String(value || '').trim()
  return raw || '-'
}

function getLocalizedProductTitle(product: any, lang: Lang, fallback = '') {
  const title = lang === 'ar'
    ? (product?.translated_title || product?.title)
    : (product?.title || product?.translated_title)
  return String(title || fallback || '').trim()
}

function getLocalizedVariantTitle(variant: any, lang: Lang) {
  const translatedOption = variant?.translated_option1 || variant?.translated_option2 || variant?.translated_option3
  const title = lang === 'ar'
    ? (variant?.translated_title || translatedOption || variant?.title)
    : (variant?.title || variant?.translated_title || translatedOption)
  return getDisplaySize(title)
}

function getProductImageSrc(product: any) {
  return product?.images?.[0]?.src || product?.image?.src || ''
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
    overviewSub: 'Performance metrics for your products on your store.',
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
    inventorySub: '',
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
    overviewSub: 'أهم الأرقام ديال المنتوجات ديالك فمتجرك.',
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
    inventorySub: '',
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
    overviewSub: 'Performance metrics for your products on your store.',
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
    inventorySub: '',
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
    addProductSub: 'Upload the image, choose colors, enter pricing, and add inventory.',
    productPhoto: 'Product Photo',
    productPreview: 'Product preview',
    catalogImage: 'Catalog Image',
    addCatalogImage: 'Add Catalog Image',
    catalogImageOptional: 'Optional image for catalog/listing display.',
    catalogImageUploaded: 'Catalog image uploaded.',
    removeCatalogImage: 'Remove catalog image',
    takePhotoOrUpload: 'Take a photo or upload an image of your product',
    generatedAfterCreate: '',
    takePhoto: 'Take Photo',
    upload: 'Upload',
    retake: 'Retake',
    uploadingImage: 'Uploading image...',
    imageUploaded: 'Image uploaded.',
    uploadFailed: 'Upload failed. Please try again.',
    uploadError: 'Upload error. Please try again.',
    backgroundAnalysisStarts: 'Background analysis starts after save',
    colorsTitle: 'Colors',
    colorsLabel: 'Product Colors',
    colorPlaceholder: 'Enter color name...',
    addColor: 'Add',
    noColorsYet: 'No colors added yet.',
    hiddenCatalogNote: 'Catalog data, title, and description are hidden here and will be generated after the product is submitted.',
    financialsTitle: 'Pricing',
    cogPrice: 'Unit Cost Price (optional)',
    salePrice: 'Unit Sale Price',
    compareAtPrice: 'Compare at Price (optional)',
    estimatedProfit: 'Est. Unit Profit',
    stockVariants: 'Inventory',
    addRange: 'Add Size',
    sku: 'Product Code',
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
    vendorFieldNote: '',
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
    productCreatedSuccess: 'Product created successfully.',
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
    orderWorkflowStatus: 'Order Status',
    newStatus: 'New',
    processingStatus: 'Processing',
    fulfilledStatus: 'Fulfilled',
    markProcessing: 'Mark Processing',
    markFulfilled: 'Mark Fulfilled',
    orderStatusUpdated: 'Order status updated',
    orderStatusUpdateFailed: 'Could not update order status',
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
    overviewSub: 'مؤشرات أداء منتجاتك في متجرك.',
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
    inventorySub: '',
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
    addProductSub: 'ارفع الصورة، واختر الألوان، وأدخل ثمن المنتج، ثم أضف الكمية والمخزون.',
    productPhoto: 'صورة المنتج',
    productPreview: 'معاينة المنتج',
    catalogImage: 'صورة الكتالوج',
    addCatalogImage: 'إضافة صورة الكتالوج',
    catalogImageOptional: 'صورة اختيارية للكتالوج وقائمة المنتجات.',
    catalogImageUploaded: 'تم رفع صورة الكتالوج.',
    removeCatalogImage: 'إزالة صورة الكتالوج',
    takePhotoOrUpload: 'التقط صورة أو ارفع صورة للمنتج',
    generatedAfterCreate: '',
    takePhoto: 'التقاط صورة',
    upload: 'رفع صورة',
    retake: 'إعادة الالتقاط',
    uploadingImage: 'جارٍ رفع الصورة...',
    imageUploaded: 'تم رفع الصورة.',
    uploadFailed: 'فشل رفع الصورة. يرجى المحاولة مرة أخرى.',
    uploadError: 'حدث خطأ أثناء رفع الصورة. يرجى المحاولة مرة أخرى.',
    backgroundAnalysisStarts: 'سيبدأ التحليل في الخلفية بعد الحفظ',
    colorsTitle: 'الألوان',
    colorsLabel: 'ألوان المنتج',
    colorPlaceholder: 'أدخل اسم اللون...',
    addColor: 'إضافة',
    noColorsYet: 'لم تتم إضافة أي ألوان بعد.',
    hiddenCatalogNote: 'بيانات الكتالوج والعنوان والوصف مخفية هنا، وسيتم إنشاؤها بعد إرسال المنتج.',
    financialsTitle: 'ثمن المنتج',
    cogPrice: 'سعر التكلفة',
    salePrice: 'سعر البيع',
    compareAtPrice: 'سعر المقارنة (اختياري)',
    estimatedProfit: 'صافي الربح المتوقع',
    stockVariants: 'الكمية والمخزون',
    addRange: 'اضف قياس',
    sku: 'رمز المنتج',
    from: 'من',
    to: 'إلى',
    qty: 'الكمية',
    stockVariantNote: 'يستخدم كل تنويع من المخزون رمز SKU وكمية خاصين به.',
    productsTaggedAs: 'سيتم وسم المنتجات باسم',
    vendorFieldNote: '',
    createProductCta: 'إنشاء المنتج',
    creatingProduct: 'جارٍ إنشاء المنتج...',
    uploadImageRequired: 'يرجى رفع صورة للمنتج.',
    colorRequired: 'يرجى إضافة لون واحد على الأقل.',
    stockVariantRequired: 'يرجى إضافة تنويع مخزون واحد على الأقل.',
    skuRequired: 'يرجى إدخال رمز SKU لكل تنويع مخزون.',
    errorPrefix: 'خطأ',
    saveProductError: 'حدث خطأ أثناء حفظ المنتج:',
    productCreatedSuccess: 'تم إنشاء المنتج بنجاح.',
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
    orderWorkflowStatus: 'حالة الطلب',
    newStatus: 'جديد',
    processingStatus: 'قيد المعالجة',
    fulfilledStatus: 'تم الارسال',
    markProcessing: 'قيد المعالجة',
    markFulfilled: 'تم الارسال',
    orderStatusUpdated: 'تم تحديث حالة الطلب',
    orderStatusUpdateFailed: 'تعذر تحديث حالة الطلب',
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
  overviewSub: 'مؤشرات أداء منتجاتك في متجرك.',
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
  inventorySub: '',
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
  addProductSub: 'ارفع الصورة، واختر الألوان، وأدخل ثمن المنتج، ثم أضف الكمية والمخزون.',
  productPhoto: 'صورة المنتج',
  productPreview: 'معاينة المنتج',
  catalogImage: 'صورة الكتالوج',
  addCatalogImage: 'إضافة صورة الكتالوج',
  catalogImageOptional: 'صورة اختيارية للكتالوج وقائمة المنتجات.',
  catalogImageUploaded: 'تم رفع صورة الكتالوج.',
  removeCatalogImage: 'إزالة صورة الكتالوج',
  takePhotoOrUpload: 'التقط صورة أو ارفع صورة للمنتج',
  generatedAfterCreate: '',
  takePhoto: 'التقاط صورة',
  upload: 'رفع صورة',
  retake: 'إعادة الالتقاط',
  uploadingImage: 'جارٍ رفع الصورة...',
  imageUploaded: 'تم رفع الصورة.',
  uploadFailed: 'فشل رفع الصورة. يُرجى المحاولة مرة أخرى.',
  uploadError: 'حدث خطأ أثناء رفع الصورة. يُرجى المحاولة مرة أخرى.',
  backgroundAnalysisStarts: 'سيبدأ التحليل في الخلفية بعد الحفظ',
  colorsTitle: 'الألوان',
  colorsLabel: 'ألوان المنتج',
  colorPlaceholder: 'أدخل اسم اللون...',
  addColor: 'إضافة',
  noColorsYet: 'لم تتم إضافة أي ألوان بعد.',
  hiddenCatalogNote: 'بيانات الكتالوج والعنوان والوصف مخفية هنا، وسيتم إنشاؤها بعد إرسال المنتج.',
  financialsTitle: 'ثمن المنتج',
  cogPrice: 'سعر تكلفة الوحدة',
  salePrice: 'سعر بيع الوحدة',
  compareAtPrice: 'سعر مقارنة الوحدة (اختياري)',
  estimatedProfit: 'الربح المتوقع للوحدة',
  stockVariants: 'الكمية والمخزون',
  addRange: 'اضف قياس',
  sku: 'رمز المنتج',
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
  vendorFieldNote: '',
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
  productCreatedSuccess: 'تم إنشاء المنتج بنجاح.',
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
  orderWorkflowStatus: 'حالة الطلب',
  newStatus: 'جديد',
  processingStatus: 'قيد المعالجة',
    fulfilledStatus: 'تم الارسال',
  markProcessing: 'قيد المعالجة',
    markFulfilled: 'تم الارسال',
  orderStatusUpdated: 'تم تحديث حالة الطلب',
  orderStatusUpdateFailed: 'تعذر تحديث حالة الطلب',
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
      case 'inventory': return <InventoryTab vendor={vendor} products={products} loading={loadingProducts} copy={copy} lang={lang} onAddProduct={() => setActiveTab('add-new')} onCreateOrder={() => setActiveTab('create-order')} onInventoryChanged={refreshProducts} />
      case 'create-order': return <CreateOrderTabSimpleInvoice vendor={vendor} products={products} onDone={() => { refreshOrders(); setActiveTab('orders') }} copy={copy} lang={lang} />
      case 'add-new': return <AddNewTab vendor={vendor} onDone={() => { refreshProducts(); setActiveTab('inventory') }} copy={copy} lang={lang} />
      case 'orders': return <OrdersTab vendor={vendor} products={products} initialOrders={orderStats?.all_orders || []} copy={copy} lang={lang} onCreateOrder={() => setActiveTab('create-order')} onAddProduct={() => setActiveTab('add-new')} />
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
          <NavItem active={activeTab==='orders' || activeTab==='create-order'} onClick={()=>setActiveTab('orders')} icon={<ClipboardList size={20}/>} label={copy.orders} />
          <NavItem active={activeTab==='inventory' || activeTab==='add-new'} onClick={()=>setActiveTab('inventory')} icon={<Package size={20}/>} label={copy.inventory} />
          <NavItem active={activeTab==='customers'} onClick={()=>setActiveTab('customers')} icon={<Users size={20}/>} label={copy.customers} />
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
          <div className="relative rounded-2xl md:rounded-[24px] border border-slate-200/80 bg-white px-3 py-2.5 md:px-7 md:py-4 text-slate-900 shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
              <div className="min-w-0 flex items-center gap-2.5">
                <div className="flex h-9 w-9 md:h-10 md:w-10 items-center justify-center rounded-xl md:rounded-2xl bg-slate-950 text-white shadow-lg shadow-slate-200">
                  <Package size={18} />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm md:text-lg font-black tracking-[0.12em] uppercase">{copy.brand}</p>
                  <p className="hidden md:block text-[10px] uppercase tracking-[0.3em] text-slate-400">{copy.brandTag}</p>
                </div>
              </div>
              <div className="min-w-0 text-center">
                <p className="truncate text-xs font-bold uppercase tracking-[0.22em] text-slate-400">{copy.role}</p>
                <p className="truncate text-lg md:text-2xl font-black text-slate-950">{vendor.name || vendor.username || '-'}</p>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={toggleLang}
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] md:px-4 md:py-2 md:text-sm font-bold text-slate-700 transition hover:bg-slate-100"
                >
                  <span className="hidden sm:inline text-slate-500">{copy.languageLabel}</span>
                  <span className="rounded-full bg-white px-2 py-0.5 text-[10px] shadow-sm">{lang === 'ar' ? copy.arabic : copy.english}</span>
                </button>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowSettings(v => !v)}
                    className="inline-flex h-10 w-10 md:h-11 md:w-11 items-center justify-center rounded-xl md:rounded-2xl border border-slate-200 bg-slate-50 text-slate-700 transition hover:bg-slate-100"
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
        <div className="p-4 md:p-8 pt-5">
          {activeTab === 'overview' && (
            <div className="mx-auto mb-5 grid max-w-6xl grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setActiveTab('create-order')}
                className="flex min-h-[78px] items-center justify-center gap-3 rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-500 to-teal-600 px-3 py-4 text-sm font-black text-white shadow-lg shadow-emerald-200/60 transition active:scale-[0.98]"
              >
                <ClipboardList size={22} />
                <span>{copy.createOrder}</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('add-new')}
                className="flex min-h-[78px] items-center justify-center gap-3 rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-600 to-indigo-600 px-3 py-4 text-sm font-black text-white shadow-lg shadow-blue-200/60 transition active:scale-[0.98]"
              >
                <PlusCircle size={22} />
                <span>{copy.addProduct}</span>
              </button>
            </div>
          )}
          {renderContent()}
        </div>
      </main>

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-lg border-t border-slate-200/80 px-3 py-2 flex justify-around items-center z-50 shadow-[0_-8px_30px_rgba(0,0,0,0.08)]">
        <MobileNavItem active={activeTab==='overview'} onClick={()=>setActiveTab('overview')} icon={<LayoutDashboard size={30}/>} label={copy.home} />
        <MobileNavItem active={activeTab==='orders' || activeTab==='create-order'} onClick={()=>setActiveTab('orders')} icon={<ClipboardList size={30}/>} label={copy.orders} />
        <MobileNavItem active={activeTab==='inventory' || activeTab==='add-new'} onClick={()=>setActiveTab('inventory')} icon={<Package size={30}/>} label={copy.stock} />
        <MobileNavItem active={activeTab==='customers'} onClick={()=>setActiveTab('customers')} icon={<Users size={30}/>} label={copy.customers} />
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
function MobileNavItem({ active, onClick, icon, label, isHighlight }: any) {
  if (isHighlight) {
    return (
      <button onClick={onClick} className={`flex flex-col items-center justify-center gap-1 min-h-[64px] min-w-[72px] rounded-2xl transition-all duration-200 px-2 ${
        active
          ? 'bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-200/50 scale-105'
          : 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100'
      }`}>
        {icon}
        <span className="text-[11px] font-black uppercase tracking-tight leading-tight">{label}</span>
      </button>
    )
  }
  return (
    <button onClick={onClick} className={`flex flex-col items-center justify-center gap-1 min-h-[64px] min-w-[72px] rounded-2xl border transition-all duration-200 px-2 ${
      active
        ? 'border-blue-200 bg-blue-600 text-white shadow-lg shadow-blue-200 scale-105'
        : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50'
    }`}>
      {icon}
      <span className={`text-[11px] font-bold uppercase tracking-tight leading-tight ${active ? 'font-black' : ''}`}>{label}</span>
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
    <div className="bg-white p-3 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-3">
      <div className="p-2 bg-slate-50 rounded-xl flex-shrink-0">{icon}</div>
      <div className="min-w-0">
        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider leading-none">{label}</p>
        <p className="text-lg font-black leading-tight">{value}</p>
        <p className="text-[9px] text-slate-400 truncate">{sub}</p>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════
//  OVERVIEW TAB
// ═══════════════════════════════════════════════════
function OverviewTab({ products, loading, orderStats, copy, lang }: { products: any[]; loading: boolean; orderStats: any; copy: AppCopy; lang: Lang }) {
  const locale = getLocale(lang)
  const [dateRange, setDateRange] = useState('all')

  const totalStock = useMemo(() => products.reduce((a, p) => {
    const vars = p.variants || []
    return a + vars.reduce((s: number, v: any) => s + (parseInt(v.inventory_quantity) || 0), 0)
  }, 0), [products])

  const totalValue = useMemo(() => products.reduce((a, p) => {
    const vars = p.variants || []
    return a + vars.reduce((s: number, v: any) => s + (parseFloat(v.price) || 0) * (parseInt(v.inventory_quantity) || 0), 0)
  }, 0), [products])

  // Filter orders by date range
  const filteredStats = useMemo(() => {
    if (!orderStats?.all_orders) return orderStats
    if (dateRange === 'all') return orderStats
    const now = new Date()
    let cutoff = new Date()
    if (dateRange === 'today') cutoff.setHours(0,0,0,0)
    else if (dateRange === '7d') cutoff.setDate(now.getDate() - 7)
    else if (dateRange === '30d') cutoff.setDate(now.getDate() - 30)
    else if (dateRange === '90d') cutoff.setDate(now.getDate() - 90)
    const filtered = orderStats.all_orders.filter((o: any) => new Date(o.created_at) >= cutoff)
    const totalOrders = filtered.length
    const totalUnits = filtered.reduce((s: number, o: any) => s + (o.units || 0), 0)
    const totalRevenue = filtered.reduce((s: number, o: any) => s + (parseFloat(o.total_price) || 0), 0)
    return { ...orderStats, total_orders: totalOrders, total_units_sold: totalUnits, total_revenue: Math.round(totalRevenue * 100) / 100 }
  }, [orderStats, dateRange])

  const avgOrderValue = useMemo(() => {
    if (!filteredStats?.total_orders || filteredStats.total_orders === 0) return 0
    return Math.round((filteredStats.total_revenue / filteredStats.total_orders) * 100) / 100
  }, [filteredStats])

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

  const dateRanges = [
    { value: 'today', label: lang === 'ar' ? 'اليوم' : 'Today' },
    { value: '7d', label: lang === 'ar' ? '7 أيام' : '7 Days' },
    { value: '30d', label: lang === 'ar' ? '30 يوم' : '30 Days' },
    { value: '90d', label: lang === 'ar' ? '90 يوم' : '90 Days' },
    { value: 'all', label: lang === 'ar' ? 'كل الوقت' : 'All Time' },
  ]

  return (
    <div className="space-y-4 max-w-6xl mx-auto animate-in pb-6">
      {/* Header + Date Range */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">{copy.overviewTitle}</h2>
            <p className="text-slate-500 text-xs">{copy.overviewSub}</p>
          </div>
          <div className="bg-white border border-slate-200 p-1 rounded-xl shadow-sm flex items-center gap-0.5 text-[10px] font-bold">
            {dateRanges.map(r => (
              <button key={r.value} onClick={() => setDateRange(r.value)} className={`px-2.5 py-1.5 rounded-lg transition-all ${dateRange === r.value ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}>
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Metrics Grid - 2x3 compact grid, all visible on mobile */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 md:gap-3">
        <StatsCard label={copy.totalProducts} value={loading ? '...' : products.length} sub={copy.inventoryLevelSub} icon={<Package size={16} className="text-blue-600" />} />
        <StatsCard label={copy.inventoryLevel} value={loading ? '...' : totalStock.toLocaleString(locale)} sub="Total units in stock" icon={<Box size={16} className="text-indigo-600" />} />
        <StatsCard label={copy.inventoryValue} value={loading ? '...' : formatDh(totalValue, locale)} sub="Stock value" icon={<DollarSign size={16} className="text-green-600" />} />
        <StatsCard label={copy.ordersStat} value={filteredStats ? filteredStats.total_orders : '...'} sub={filteredStats ? ` ` : '...'} icon={<ShoppingCart size={16} className="text-emerald-600" />} />
        <StatsCard label={copy.unitsSold} value={filteredStats ? filteredStats.total_units_sold : '...'} sub={copy.unitsSoldSub} icon={<TrendingUp size={16} className="text-orange-600" />} />
        <StatsCard label="Avg Order" value={filteredStats ? formatDh(avgOrderValue, locale) : '...'} sub="Per order value" icon={<BarChart3 size={16} className="text-purple-600" />} />
      </div>

      {/* Segment breakdown - compact */}
      {segmentData.length > 0 && (
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
          <h3 className="text-sm font-bold mb-3">{copy.productsBySegment}</h3>
          <div className="space-y-2">
            {segmentData.map(s => (
              <div key={s.name} className="flex items-center gap-3">
                <div className="w-20 text-xs font-semibold text-slate-600 truncate">{s.name}</div>
                <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full flex items-center justify-end pr-2" style={{ width: `%` }}>
                    <span className="text-[9px] text-white font-bold">{s.count}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent products - compact */}
      {products.length > 0 && (
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
          <h3 className="text-sm font-bold mb-3">{copy.recentProducts}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {products.slice(0, 6).map((p: any) => (
              <div key={p.id} className="flex items-center gap-2 p-2 bg-slate-50 rounded-xl border border-slate-100">
                <div className="w-10 h-10 rounded-lg bg-white border border-slate-200 overflow-hidden flex items-center justify-center flex-shrink-0">
                  {p.images?.[0]?.src ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.images[0].src} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <ImageIcon size={16} className="text-slate-300" />
                  )}
                </div>
                <div className="overflow-hidden">
                  <p className="text-xs font-bold truncate">{getLocalizedProductTitle(p, lang, copy.untitled)}</p>
                  <p className="text-[9px] text-slate-500">{formatDh(p.variants?.[0]?.price || '0.00', locale)}</p>
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
function InventoryTab({ vendor, products, loading, copy, lang, onAddProduct, onCreateOrder, onInventoryChanged }: { vendor: any; products: any[]; loading: boolean; copy: AppCopy; lang: Lang; onAddProduct?: () => void; onCreateOrder?: () => void; onInventoryChanged?: () => void }) {
  const [search, setSearch] = useState('')
  const [segFilter, setSegFilter] = useState('All')
  const [inventorySort, setInventorySort] = useState<'newest' | 'oldest' | 'quantity'>('newest')
  const [stockModal, setStockModal] = useState<{ product: any; variant: any } | null>(null)
  const [stockQty, setStockQty] = useState('')
  const [stockSaving, setStockSaving] = useState(false)
  const [stockMessage, setStockMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [imageModal, setImageModal] = useState<{ src: string; title: string } | null>(null)
  const [imageSharing, setImageSharing] = useState(false)
  const [expandedProductId, setExpandedProductId] = useState<string | null>(null)
  const locale = getLocale(lang)
  const isArabic = lang === 'ar'
  const inventoryLabels = {
    available: isArabic ? 'المتاح' : 'Available',
    onHand: isArabic ? 'في اليد' : 'On hand',
    edit: isArabic ? 'تعديل المخزون' : 'Edit stock',
    save: isArabic ? 'حفظ المخزون' : 'Save stock',
    saved: isArabic ? 'تم تحديث المخزون' : 'Inventory updated',
    failed: isArabic ? 'تعذر تحديث المخزون' : 'Could not update inventory',
    variants: isArabic ? 'المتغيرات' : 'variants',
    preview: isArabic ? 'معاينة الصورة' : 'Image preview',
    share: isArabic ? 'مشاركة' : 'Share',
  }
  const sortLabels = {
    newest: isArabic ? 'الأحدث أولًا' : 'Newest first',
    oldest: isArabic ? 'الأقدم أولًا' : 'Old to new',
    quantity: isArabic ? 'الأكثر كمية' : 'Most quantity',
  }

  const filtered = useMemo(() => {
    const list = products.filter(p => {
      const q = search.toLowerCase()
      const productTitle = getLocalizedProductTitle(p, lang, p.title || copy.untitled).toLowerCase()
      const matchSearch = !search || productTitle.includes(q) || (p.variants || []).some((v: any) =>
        getDisplaySku(v.sku).toLowerCase().includes(q) || getLocalizedVariantTitle(v, lang).toLowerCase().includes(q)
      )
      if (segFilter === 'All') return matchSearch
      const tags = typeof p.tags === 'string' ? p.tags : ''
      return matchSearch && tags.includes(`segment:${segFilter}`)
    })
    return list.sort((a: any, b: any) => {
      if (inventorySort === 'quantity') {
        const qa = (a.variants || []).reduce((s: number, v: any) => s + getVariantAvailable(v), 0)
        const qb = (b.variants || []).reduce((s: number, v: any) => s + getVariantAvailable(v), 0)
        return qb - qa
      }
      const da = new Date(a.created_at || 0).getTime()
      const db = new Date(b.created_at || 0).getTime()
      return inventorySort === 'oldest' ? da - db : db - da
    })
  }, [products, search, segFilter, inventorySort, lang, copy.untitled])

  function openStockModal(product: any, variant: any) {
    setStockModal({ product, variant })
    setStockQty(String(getVariantOnHand(variant)))
    setStockMessage(null)
  }

  async function saveStock() {
    if (!stockModal) return
    const qty = Math.max(0, parseInt(stockQty, 10) || 0)
    setStockSaving(true)
    setStockMessage(null)
    try {
      const res = await apiPatch(`/api/wholesale/vendors/${vendor.id}/products/${stockModal.product.id}/variants/${stockModal.variant.id}/inventory`, { quantity: qty })
      if (res?.error) {
        setStockMessage({ type: 'error', text: `${inventoryLabels.failed}: ${res.error}` })
        return
      }
      setStockMessage({ type: 'success', text: inventoryLabels.saved })
      onInventoryChanged?.()
      setTimeout(() => setStockModal(null), 650)
    } catch (err: any) {
      setStockMessage({ type: 'error', text: `${inventoryLabels.failed}: ${err?.message || err}` })
    } finally {
      setStockSaving(false)
    }
  }

  async function shareProductImage(channel: 'native' | 'whatsapp' | 'telegram' = 'native') {
    if (!imageModal?.src) return
    setImageSharing(true)
    const shareText = `${imageModal.title}\n${imageModal.src}`
    try {
      if (channel === 'whatsapp') {
        window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank', 'noopener,noreferrer')
        return
      }
      if (channel === 'telegram') {
        window.open(`https://t.me/share/url?url=${encodeURIComponent(imageModal.src)}&text=${encodeURIComponent(imageModal.title)}`, '_blank', 'noopener,noreferrer')
        return
      }
      if (navigator.share) {
        try {
          const response = await fetch(imageModal.src, { mode: 'cors' })
          const blob = await response.blob()
          const ext = blob.type?.split('/')[1] || 'jpg'
          const file = new File([blob], `${(imageModal.title || 'product').replace(/[^\w-]+/g, '-').slice(0, 40)}.${ext}`, { type: blob.type || 'image/jpeg' })
          const shareData = { title: imageModal.title, text: imageModal.title, files: [file] }
          if (navigator.canShare?.(shareData)) {
            await navigator.share(shareData)
            return
          }
        } catch {
          // Fall back to sharing the image URL when the CDN blocks file sharing.
        }
        await navigator.share({ title: imageModal.title, text: shareText, url: imageModal.src })
        return
      }
      window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank', 'noopener,noreferrer')
    } finally {
      setImageSharing(false)
    }
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-10 animate-in">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold">{copy.inventoryTitle}</h2>
        </div>
        <div className="flex gap-2">
          {onAddProduct && (
            <button onClick={onAddProduct} className="flex items-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white px-5 py-3 rounded-2xl font-bold shadow-lg shadow-blue-200/50 transition-all active:scale-[0.97] text-sm">
              <PlusCircle size={18} />
              {copy.addProduct}
            </button>
          )}
          {onCreateOrder && (
            <button onClick={onCreateOrder} className="flex items-center gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white px-5 py-3 rounded-2xl font-bold shadow-lg shadow-emerald-200/50 transition-all active:scale-[0.97] text-sm">
              <ShoppingCart size={18} />
              {copy.createOrder}
            </button>
          )}
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
        <select value={inventorySort} onChange={e => setInventorySort(e.target.value as any)}
          className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none"
        >
          <option value="newest">{sortLabels.newest}</option>
          <option value="oldest">{sortLabels.oldest}</option>
          <option value="quantity">{sortLabels.quantity}</option>
        </select>
      </div>

      {/* Inventory Cards */}
      <div className="space-y-4">
        {loading && (
          <div className="py-12 text-center">
            <Loader2 className="animate-spin text-blue-500 mx-auto mb-2" size={24} />
            <p className="text-slate-400 text-sm">{copy.loadingProducts}</p>
          </div>
        )}
        {!loading && filtered.map((p: any) => {
          const variants = p.variants || []
          const qty = variants.reduce((s: number, v: any) => s + getVariantAvailable(v), 0)
          const variantCount = variants.length
          const productKey = String(p.id)
          const isExpanded = expandedProductId === productKey
          const productTitle = getLocalizedProductTitle(p, lang, copy.untitled)
          const imageSrc = getProductImageSrc(p)
          return (
            <div key={p.id} className={`overflow-hidden rounded-[24px] border bg-white shadow-sm transition-all ${isExpanded ? 'border-blue-200 shadow-blue-100/60' : 'border-slate-200'}`}>
              <button
                type="button"
                onClick={() => setExpandedProductId(isExpanded ? null : productKey)}
                className="w-full text-left transition-all hover:bg-slate-50/50"
              >
                <div className="relative aspect-[16/9] w-full overflow-hidden bg-slate-100">
                  {imageSrc ? (
                    <img src={imageSrc} alt={productTitle} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-slate-300">
                      <Package size={42} />
                    </div>
                  )}
                  {imageSrc && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={e => { e.stopPropagation(); setImageModal({ src: imageSrc, title: productTitle }) }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          e.stopPropagation()
                          setImageModal({ src: imageSrc, title: productTitle })
                        }
                      }}
                      className={`absolute top-3 ${isArabic ? 'left-3' : 'right-14'} inline-flex rounded-full bg-white/95 p-2 text-slate-700 shadow-sm transition hover:bg-white hover:text-blue-600`}
                      aria-label={inventoryLabels.preview}
                    >
                      <Share2 size={18} />
                    </span>
                  )}
                  <div className={`absolute top-3 ${isArabic ? 'right-3' : 'right-3'} rounded-full bg-white/90 p-2 shadow-sm`}>
                    <ChevronRight size={18} className={`text-slate-500 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                  </div>
                  <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-slate-950/70 to-transparent p-4">
                    <div className="min-w-0 text-white">
                      <p className="truncate text-lg font-black leading-tight">{productTitle}</p>
                      <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1">
                        {variants.slice(0, 6).map((v: any) => (
                          <span key={v.id} className="text-[11px] font-black text-white/85">
                            {getDisplaySku(v.sku)}={getVariantAvailable(v)}
                          </span>
                        ))}
                        {variantCount > 6 && (
                          <span className="text-[11px] font-black text-white/70">+{variantCount - 6}</span>
                        )}
                      </div>
                    </div>
                    <div className={`${isArabic ? 'text-left' : 'text-right'} rounded-2xl bg-white/95 px-3 py-2 text-slate-950 shadow-sm`}>
                      <p className="text-3xl font-black leading-none">{qty}</p>
                      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{inventoryLabels.available}</p>
                    </div>
                  </div>
                </div>
              </button>
              {isExpanded && variants.length > 0 && (
                <div className="grid grid-cols-1 gap-2 border-t border-slate-100 bg-slate-50/70 p-3 sm:grid-cols-2">
                  {variants.map((v: any) => {
                    const available = getVariantAvailable(v)
                    const onHand = getVariantOnHand(v)
                    return (
                      <div key={v.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                        <div className="min-w-0">
                          <p className="truncate text-lg font-black text-slate-900">{getDisplaySku(v.sku)}</p>
                          <p className="truncate text-sm font-bold text-slate-500">{getLocalizedVariantTitle(v, lang)}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className={`grid grid-cols-2 gap-2 ${isArabic ? 'text-left' : 'text-right'}`}>
                            <div>
                              <p className="text-[10px] font-black uppercase text-slate-400">{inventoryLabels.onHand}</p>
                              <p className="text-xl font-black text-slate-900">{onHand}</p>
                            </div>
                            <div>
                              <p className="text-[10px] font-black uppercase text-emerald-600">{inventoryLabels.available}</p>
                              <p className="text-xl font-black text-emerald-700">{available}</p>
                            </div>
                          </div>
                          <button onClick={() => openStockModal(p, v)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-700 hover:border-blue-300 hover:text-blue-600">
                            {inventoryLabels.edit}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
        {!loading && filtered.length === 0 && (
          <div className="py-12 text-center">
            <div className="w-16 h-16 bg-slate-50 text-slate-200 rounded-full flex items-center justify-center mx-auto mb-3"><Package size={32}/></div>
            <p className="text-slate-400 font-medium">{copy.noProducts}</p>
          </div>
        )}
      </div>

      {stockModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={() => setStockModal(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-lg font-bold text-slate-900">{inventoryLabels.edit}</p>
                <p className="mt-1 truncate text-sm font-bold text-slate-600">{getDisplaySku(stockModal.variant.sku)}</p>
                <p className="text-xs text-slate-400">{getLocalizedVariantTitle(stockModal.variant, lang)}</p>
              </div>
              <button onClick={() => setStockModal(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X size={18} /></button>
            </div>
            <div className="mt-5">
              <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-400">{inventoryLabels.onHand}</label>
              <input
                type="number"
                min="0"
                value={stockQty}
                onChange={e => setStockQty(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-lg font-black outline-none focus:ring-2 focus:ring-blue-500/30"
              />
              <p className="mt-2 text-xs font-semibold text-slate-500">{inventoryLabels.available}: {getVariantAvailable(stockModal.variant)}</p>
            </div>
            {stockMessage && (
              <div className={`mt-4 rounded-xl border px-4 py-3 text-xs font-bold ${stockMessage.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-600'}`}>
                {stockMessage.text}
              </div>
            )}
            <button onClick={saveStock} disabled={stockSaving} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60">
              {stockSaving ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle size={16} />}
              {inventoryLabels.save}
            </button>
          </div>
        </div>
      )}

      {imageModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setImageModal(null)}>
          <div className="w-full max-w-3xl overflow-hidden rounded-3xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-black text-slate-900">{inventoryLabels.preview}</p>
                <p className="truncate text-xs font-semibold text-slate-500">{imageModal.title}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => shareProductImage('native')}
                  disabled={imageSharing}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-3 py-2 text-xs font-bold text-white transition hover:bg-slate-800 disabled:opacity-60"
                >
                  {imageSharing ? <Loader2 className="animate-spin" size={15} /> : <Share2 size={15} />}
                  {inventoryLabels.share}
                </button>
                <button
                  type="button"
                  onClick={() => shareProductImage('whatsapp')}
                  className="inline-flex items-center rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-emerald-700"
                >
                  WhatsApp
                </button>
                <button
                  type="button"
                  onClick={() => shareProductImage('telegram')}
                  className="inline-flex items-center rounded-xl bg-sky-500 px-3 py-2 text-xs font-bold text-white transition hover:bg-sky-600"
                >
                  Telegram
                </button>
                <button onClick={() => setImageModal(null)} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900">
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="max-h-[78vh] bg-slate-50 p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageModal.src} alt={imageModal.title} className="mx-auto max-h-[74vh] w-auto max-w-full rounded-2xl object-contain bg-white" />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
function AddNewTab({ vendor, onDone, copy, lang }: { vendor: any; onDone: () => void; copy: AppCopy; lang: Lang }) {
  const [saving, setSaving] = useState(false)
  const [colorInput, setColorInput] = useState('')
  const [form, setForm] = useState({
    title: '',
    description: '',
    cogPrice: '', salePrice: '', compareAtPrice: '',
    segment: SEGMENTS[0],
    season: SEASONS[0],
    colors: [] as string[],
    sizeGroups: [createStockVariantRow()] as StockVariantFormRow[],
    variantGroupId: '',
  })
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [catalogImagePreview, setCatalogImagePreview] = useState<string | null>(null)
  const [catalogImageUrl, setCatalogImageUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [catalogUploading, setCatalogUploading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<string | null>(null)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [aiStatus, setAiStatus] = useState<string | null>(null)
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const catalogFileInputRef = useRef<HTMLInputElement>(null)

  const locale = getLocale(lang)
  const unitSalePrice = toNumber(form.salePrice)
  const netProfit = useMemo(() => {
    const cog = toNumber(form.cogPrice)
    return unitSalePrice - cog
  }, [form.cogPrice, unitSalePrice])
  const storeType = vendor.store_type || vendor.storeType || 'shoes'
  const isShoes = storeType === 'shoes'
  const isClothes = storeType === 'clothes'
  const isElectronics = storeType === 'electronics' || storeType === 'general'
  const isArabic = lang === 'ar'

  // Clothes-specific state
  const CLOTHES_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL']
  const [clothesSizes, setClothesSizes] = useState<Record<string, number | string>>({})
  // Electronics/General simple quantity
  const [simpleQty, setSimpleQty] = useState<number | string>('')

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
        return { ...group, [key]: value }
      }),
    }))
  }

  async function uploadWholesaleImage(file: File) {
    const fd = new FormData()
    fd.append('image', file)
    const res = await fetch(`${API}/api/wholesale/upload-image`, { method: 'POST', body: fd })
    const data = await res.json()
    return data?.data?.url ? String(data.data.url) : ''
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
      const uploadedUrl = await uploadWholesaleImage(file)
      if (uploadedUrl) {
        setImageUrl(uploadedUrl)
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

  async function handleCatalogImageCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => setCatalogImagePreview(ev.target?.result as string)
    reader.readAsDataURL(file)
    setCatalogUploading(true)
    setUploadStatus(copy.uploadingImage)
    try {
      const uploadedUrl = await uploadWholesaleImage(file)
      if (uploadedUrl) {
        setCatalogImageUrl(uploadedUrl)
        setUploadStatus(copy.catalogImageUploaded)
      } else {
        setUploadStatus(copy.uploadFailed)
      }
    } catch {
      setUploadStatus(copy.uploadError)
    } finally {
      setCatalogUploading(false)
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
    setCatalogImagePreview(null)
    setCatalogImageUrl(null)
    setAiStatus(null)
    setUploadStatus(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (catalogFileInputRef.current) catalogFileInputRef.current.value = ''
  }

  function removeCatalogImage() {
    setCatalogImagePreview(null)
    setCatalogImageUrl(null)
    if (catalogFileInputRef.current) catalogFileInputRef.current.value = ''
  }

  async function handleSubmit() {
    if (!imageUrl) { setSaveMessage({ type: 'error', text: copy.uploadImageRequired }); return }
    if (isShoes || isClothes) {
      if (form.colors.length === 0) { setSaveMessage({ type: 'error', text: copy.colorRequired }); return }
    }
    if (unitSalePrice <= 0) { setSaveMessage({ type: 'error', text: copy.unitSalePriceRequired }); return }
    if (isShoes) {
      if (form.sizeGroups.length === 0) { setSaveMessage({ type: 'error', text: copy.stockVariantRequired }); return }
      if (form.sizeGroups.some(group => !group.sku.trim())) { setSaveMessage({ type: 'error', text: copy.skuRequired }); return }
      if (form.sizeGroups.some(group => toInteger(group.pcsPerCrate) <= 0)) { setSaveMessage({ type: 'error', text: copy.piecesPerCrateRequired }); return }
      if (form.sizeGroups.some(group => toInteger(group.crateQty) <= 0)) { setSaveMessage({ type: 'error', text: copy.crateQuantityRequired }); return }
    }
    setSaving(true)
    setSaveMessage({ type: 'success', text: lang === 'ar' ? 'جاري إنشاء المنتج...' : 'Creating product...' })
    try {
      // Build request body based on store type
      const reqBody: any = {
        cog_price: parseFloat(form.cogPrice) || undefined,
        sale_price: unitSalePrice || undefined,
        compare_at_price: parseFloat(form.compareAtPrice) || undefined,
        image_url: imageUrl || undefined,
        catalog_image_url: catalogImageUrl || undefined,
      }
      if (isShoes || isClothes) {
        reqBody.colors = form.colors.length > 0 ? form.colors : undefined
      }
      if (isShoes) {
        reqBody.size_groups = form.sizeGroups.map(group => ({
          from: String(group.from || '').trim(),
          to: String(group.to || '').trim(),
          pcs_per_crate: toInteger(group.pcsPerCrate),
          crate_quantity: toInteger(group.crateQty),
          sku: group.sku.trim(),
        }))
      }
      if (isClothes) {
        const activeSizes = Object.entries(clothesSizes).filter(([, qty]) => toInteger(qty) > 0)
        reqBody.size_groups = activeSizes.map(([size, qty]) => ({
          from: size, to: size, pcs_per_crate: 1, crate_quantity: toInteger(qty), sku: form.sizeGroups[0]?.sku?.trim() || '',
        }))
      }
      if (isElectronics) {
        reqBody.title = form.title || undefined
        reqBody.description = form.description || undefined
        reqBody.size_groups = [{
          from: 'default', to: 'default', pcs_per_crate: 1, crate_quantity: toInteger(simpleQty), sku: form.sizeGroups[0]?.sku?.trim() || '',
        }]
      }
      const res = await apiPost(`/api/wholesale/vendors/${vendor.id}/products`, reqBody)
      if (res?.error) { setSaveMessage({ type: 'error', text: `${copy.errorPrefix}: ${res.error}` }); return }
      setSaveMessage({ type: 'success', text: copy.productCreatedSuccess })
      setTimeout(onDone, 650)
    } catch (e: any) {
      setSaveMessage({ type: 'error', text: `${copy.saveProductError} ${e?.message || e}` })
    } finally { setSaving(false) }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-24 animate-in">
      <div>
        <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-900">{copy.addProductTitle}</h2>
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
            <div className="rounded-2xl border border-dashed border-blue-200 bg-white/80 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-500">{copy.catalogImage}</p>
                </div>
                <label className="cursor-pointer rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-black text-blue-600 transition hover:bg-blue-100">
                  {catalogUploading ? copy.uploadingImage : copy.addCatalogImage}
                  <input
                    ref={catalogFileInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleCatalogImageCapture}
                    className="hidden"
                  />
                </label>
              </div>
              {catalogImagePreview && (
                <div className="mt-3 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={catalogImagePreview} alt={copy.catalogImage} className="h-16 w-16 rounded-lg border border-white object-cover" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-slate-700">{copy.catalogImageUploaded}</p>
                  </div>
                  <button
                    type="button"
                    onClick={removeCatalogImage}
                    className="rounded-lg p-2 text-slate-400 hover:bg-white hover:text-red-500"
                    title={copy.removeCatalogImage}
                  >
                    <X size={16} />
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
        {uploading && (
          <div className="flex items-center gap-2 mt-3 text-blue-600">
            <Loader2 className="animate-spin" size={16} />
            <span className="text-xs font-bold">{copy.uploadingImage}</span>
          </div>
        )}
      </section>


      {/* Electronics/General: Product Name & Description */}
      {isElectronics && (
        <section className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm">
          <h3 className="text-[10px] font-bold uppercase text-slate-400 mb-4 flex items-center gap-2 tracking-widest">
            <TagIcon size={14} /> Product Details
          </h3>
          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">Product Name</label>
              <input type="text" value={form.title} onChange={e => setForm({...form, title: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/30" placeholder="Enter product name..." />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">Description / Configuration</label>
              <textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium outline-none resize-none h-24 focus:ring-2 focus:ring-blue-500/30" placeholder="Product description, specs, configuration..." />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">{copy.sku}</label>
                <input type="text" value={form.sizeGroups[0]?.sku || ''} onChange={e => updateSizeGroup(0, 'sku', e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none" placeholder="SKU-001" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">Quantity</label>
                <input type="number" value={simpleQty} onChange={e => setSimpleQty(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none" placeholder="1" min="1" />
              </div>
            </div>
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* LEFT COLUMN */}
        <div className="space-y-6">
          {(isShoes || isClothes) && (
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
            </div>
          </section>
          )}

          {/* Clothes: Size Selector */}
          {isClothes && (
            <section className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm">
              <h3 className="text-[10px] font-bold uppercase text-slate-400 mb-4 flex items-center gap-2 tracking-widest">
                <Layers size={14} /> {copy.stockVariants}
              </h3>
              <div className="mb-3">
                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">{copy.sku}</label>
                <input type="text" value={form.sizeGroups[0]?.sku || ''} onChange={e => updateSizeGroup(0, 'sku', e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none" placeholder="SKU-001" />
              </div>
              <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
                {CLOTHES_SIZES.map(size => (
                  <div key={size} className="flex flex-col items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setClothesSizes(prev => {
                        const isActive = Object.prototype.hasOwnProperty.call(prev, size) && prev[size] !== 0
                        if (!isActive) return { ...prev, [size]: '' }
                        const next = { ...prev }
                        delete next[size]
                        return next
                      })}
                      className={`px-3 py-2 rounded-xl text-xs font-black uppercase border-2 transition-all ${
                        Object.prototype.hasOwnProperty.call(clothesSizes, size) && clothesSizes[size] !== 0
                          ? 'bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-200'
                          : 'bg-slate-50 text-slate-500 border-slate-200 hover:border-blue-300'
                      }`}>
                      {size}
                    </button>
                    {Object.prototype.hasOwnProperty.call(clothesSizes, size) && clothesSizes[size] !== 0 && (
                      <input
                        type="number"
                        value={clothesSizes[size] ?? ''}
                        onChange={e => setClothesSizes(prev => ({ ...prev, [size]: e.target.value }))}
                        className="w-14 text-center bg-blue-50 border border-blue-200 rounded-lg px-1 py-1 text-xs font-bold outline-none"
                        placeholder="1"
                        min="1"
                      />
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* RIGHT COLUMN */}
        <div className="space-y-6">
          {/* Pricing */}
          <section className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm">
            <h3 className="text-[10px] font-bold uppercase text-slate-400 mb-4 flex items-center gap-2 tracking-widest">
              <DollarSign size={14} /> {copy.financialsTitle}
            </h3>
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">{copy.cogPrice}</label>
                  <input type="number" value={form.cogPrice} onChange={e => setForm({...form, cogPrice: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold" placeholder="0.00" />
                </div>
                <div>
                  <label className="text-[10px] font-black text-blue-600 uppercase block mb-1.5">{copy.salePrice}</label>
                  <input type="number" value={form.salePrice} onChange={e => setForm({...form, salePrice: e.target.value})} className="w-full bg-blue-50 border-2 border-blue-300 rounded-xl px-4 py-3 text-sm font-black text-blue-900 shadow-sm outline-none focus:ring-2 focus:ring-blue-500/30" placeholder="0.00" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">{copy.compareAtPrice}</label>
                  <input type="number" value={form.compareAtPrice} onChange={e => setForm({...form, compareAtPrice: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold" placeholder="0.00" />
                </div>
              </div>
              <div className="flex items-center justify-between p-4 bg-green-50 rounded-2xl border border-green-100 font-bold text-green-700">
                <span className="text-xs uppercase">{copy.estimatedProfit}</span>
                <span className="text-xl">{formatDh(netProfit, locale)}</span>
              </div>
            </div>
          </section>

          {/* Size Groups / Quantities */}
          {isShoes && (
          <section className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm">
            <div className="mb-4">
              <h3 className="text-[10px] font-bold uppercase text-slate-400 flex items-center gap-2 tracking-widest">
                <Layers size={14} /> {copy.stockVariants}
              </h3>
            </div>
            <div className="space-y-3">
              {form.sizeGroups.map((group, idx) => (
                <div key={idx} className="space-y-3 p-4 bg-slate-50 rounded-2xl border border-slate-100 relative">
                  <div className="rounded-2xl border border-slate-200 bg-white p-3">
                    <p className="mb-2 text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">{copy.from} / {copy.to}</p>
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                      <div className="flex flex-col rounded-xl border border-slate-200 bg-slate-50 p-2">
                        <span className="mb-1 text-[9px] font-bold uppercase text-slate-400">{copy.from}</span>
                      <input type="number" value={group.from}
                        onChange={e => updateSizeGroup(idx, 'from', e.target.value)}
                          className="w-full bg-transparent text-sm font-bold outline-none" placeholder="36" />
                      </div>
                      <div className="h-px w-5 bg-slate-300" />
                      <div className="flex flex-col rounded-xl border border-slate-200 bg-slate-50 p-2">
                        <span className="mb-1 text-[9px] font-bold uppercase text-slate-400">{copy.to}</span>
                      <input type="number" value={group.to}
                        onChange={e => updateSizeGroup(idx, 'to', e.target.value)}
                          className="w-full bg-transparent text-sm font-bold outline-none" placeholder="40" />
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="bg-white p-2 rounded-xl border border-slate-200 flex flex-col">
                      <span className="text-[9px] text-slate-400 font-bold uppercase mb-1">{copy.piecesPerCrate}</span>
                      <input type="number" value={group.pcsPerCrate}
                        onChange={e => updateSizeGroup(idx, 'pcsPerCrate', e.target.value)}
                        className="font-bold text-sm outline-none w-full" placeholder="24" />
                    </div>
                    <div className="bg-blue-600 p-2 rounded-xl flex flex-col border border-blue-700">
                      <span className="text-[9px] text-blue-100 font-bold uppercase mb-1">{copy.qty}</span>
                      <input type="number" value={group.crateQty}
                        onChange={e => updateSizeGroup(idx, 'crateQty', e.target.value)}
                        className="font-bold text-sm outline-none w-full text-white bg-transparent placeholder:text-blue-100/80" placeholder="10" />
                    </div>
                    <div className="bg-white p-2 rounded-xl border border-slate-200 flex flex-col">
                      <span className="text-[9px] text-slate-400 font-bold uppercase mb-1">{copy.sku}</span>
                      <input type="text" value={group.sku}
                        onChange={e => updateSizeGroup(idx, 'sku', e.target.value)}
                        className="font-bold text-sm outline-none w-full" placeholder="SKU-001" />
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
              <button onClick={addSizeGroup} className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-blue-200 bg-blue-50 px-4 py-3 text-sm font-black text-blue-600 transition hover:bg-blue-100">
                <Plus size={16} /> {copy.addRange}
              </button>
            </div>
          </section>
          )}

          <section className="hidden bg-white p-5 rounded-3xl border border-slate-200 shadow-sm">
            <h3 className="text-[10px] font-bold uppercase text-slate-400 mb-4 flex items-center gap-2 tracking-widest">
              <TagIcon size={14} /> Variant Group ID (SKU)
            </h3>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">Group ID</label>
              <input type="text" value={form.variantGroupId} onChange={e => setForm({...form, variantGroupId: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none" placeholder="e.g. SKU-0828-2" />
            </div>
          </section>

        </div>
      </div>

      {/* ── SAVE BUTTON AT BOTTOM ── */}
      <div className="pt-4">
        {saveMessage && (
          <div className={`mb-3 rounded-2xl border px-4 py-3 text-sm font-bold ${saveMessage.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-600'}`}>
            {saveMessage.text}
          </div>
        )}
        <button
          onClick={handleSubmit}
          disabled={saving || uploading || catalogUploading}
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
  const [lineItems, setLineItems] = useState<{ variant_id: number; quantity: number; title: string; sku: string; price: string; image: string | null; variantTitle: string; available: number }[]>([])
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [address, setAddress] = useState({ address1: 'NA', city: 'Casablanca', province: 'Casablanca-Settat', zip: '20000', country: 'MA' })
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState<any>(null)
  const [showProducts, setShowProducts] = useState(false)
  const [orderMessage, setOrderMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
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
          title: getLocalizedProductTitle(p, lang, p.title),
          variant_title: getLocalizedVariantTitle(v, lang),
          sku: v.sku || '',
          price: v.price || '0.00',
          inventory: getVariantAvailable(v),
          image: p.images?.[0]?.src || null,
        })
      })
    })
    return arr
  }, [products, lang])

  const filtered = useMemo(() => {
    if (!search) return allVariants.slice(0, 20)
    const q = search.toLowerCase()
    return allVariants.filter(v =>
      String(v.title || '').toLowerCase().includes(q) || String(v.sku || '').toLowerCase().includes(q) || String(v.variant_title || '').toLowerCase().includes(q)
    ).slice(0, 20)
  }, [allVariants, search])

  function addItem(v: any) {
    if (v.inventory <= 0) {
      setOrderMessage({ type: 'error', text: lang === 'ar' ? 'هذا المنتج غير متوفر في المخزون.' : 'This item is out of stock.' })
      return
    }
    const existing = lineItems.find(li => li.variant_id === v.variant_id)
    if (existing) {
      setLineItems(lineItems.map(li => li.variant_id === v.variant_id ? { ...li, quantity: Math.min(li.available, li.quantity + 1) } : li))
    } else {
      setLineItems([...lineItems, { variant_id: v.variant_id, quantity: 1, title: v.title, sku: v.sku, price: v.price, image: v.image, variantTitle: v.variant_title, available: v.inventory }])
    }
    setOrderMessage(null)
    setSearch('')
    setShowProducts(false)
  }

  function updateQty(variantId: number, delta: number) {
    setLineItems(lineItems.map(li => {
      if (li.variant_id === variantId) {
        const newQty = Math.max(1, Math.min(li.available, li.quantity + delta))
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
                <p className="mt-2 text-xs text-slate-400">{vendor.name} · Wholesale · {invoiceDate}</p>
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
                <button key={v.variant_id} onClick={() => addItem(v)} disabled={v.inventory <= 0} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors text-left border-b border-slate-50 last:border-0 disabled:cursor-not-allowed disabled:opacity-45">
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
  const [lineItems, setLineItems] = useState<{ variant_id: number; quantity: number; title: string; sku: string; price: string; image: string | null; variantTitle: string; available: number }[]>([])
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [address, setAddress] = useState<WholesaleAddressForm>(createDefaultWholesaleAddress)
  const [knownCustomers, setKnownCustomers] = useState<any[]>([])
  const [loadingCustomers, setLoadingCustomers] = useState(false)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState<any>(null)
  const [showProducts, setShowProducts] = useState(false)
  const [orderMessage, setOrderMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const [invoiceZoom, setInvoiceZoom] = useState(1)
  const [invoicePreviewUrl, setInvoicePreviewUrl] = useState<string | null>(null)
  const [invoicePreviewSize, setInvoicePreviewSize] = useState({ width: 960, height: 960 })
  const [invoiceFitScale, setInvoiceFitScale] = useState(1)
  const [invoicePreviewLoading, setInvoicePreviewLoading] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)
  const invoiceExportRef = useRef<HTMLDivElement>(null)
  const invoicePreviewViewportRef = useRef<HTMLDivElement>(null)
  const isArabic = lang === 'ar'
  const locale = getLocale(lang)

  const allVariants = useMemo(() => {
    const arr: any[] = []
    products.forEach(p => {
      ;(p.variants || []).forEach((v: any) => {
        arr.push({
          variant_id: v.id,
          title: getLocalizedProductTitle(p, lang, p.title),
          variant_title: getLocalizedVariantTitle(v, lang),
          sku: v.sku || '',
          price: v.price || '0.00',
          inventory: getVariantAvailable(v),
          image: p.images?.[0]?.src || null,
        })
      })
    })
    return arr
  }, [products, lang])

  const filtered = useMemo(() => {
    if (!search) return allVariants.slice(0, 20)
    const q = search.toLowerCase()
    return allVariants.filter(v =>
      String(v.title || '').toLowerCase().includes(q) || String(v.sku || '').toLowerCase().includes(q) || String(v.variant_title || '').toLowerCase().includes(q)
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
    if (v.inventory <= 0) {
      setOrderMessage({ type: 'error', text: lang === 'ar' ? 'هذا المنتج غير متوفر في المخزون.' : 'This item is out of stock.' })
      return
    }
    const existing = lineItems.find(li => li.variant_id === v.variant_id)
    if (existing) {
      if (existing.quantity >= existing.available) {
        setOrderMessage({ type: 'error', text: lang === 'ar' ? `المتاح فقط: ${existing.available}` : `Only ${existing.available} available.` })
        return
      }
      setLineItems(lineItems.map(li => li.variant_id === v.variant_id ? { ...li, quantity: Math.min(li.available, li.quantity + 1) } : li))
    } else {
      setLineItems([...lineItems, { variant_id: v.variant_id, quantity: 1, title: v.title, sku: v.sku, price: v.price, image: v.image, variantTitle: v.variant_title, available: v.inventory }])
    }
    setOrderMessage(null)
    setSearch('')
    setShowProducts(false)
  }

  function updateQty(variantId: number, delta: number) {
    setLineItems(lineItems.map(li => {
      if (li.variant_id !== variantId) return li
      const nextQty = Math.max(1, Math.min(li.available, li.quantity + delta))
      if (delta > 0 && li.quantity >= li.available) {
        setOrderMessage({ type: 'error', text: lang === 'ar' ? `المتاح فقط: ${li.available}` : `Only ${li.available} available.` })
      } else {
        setOrderMessage(null)
      }
      return { ...li, quantity: nextQty }
    }))
  }

  function removeItem(variantId: number) {
    setLineItems(lineItems.filter(li => li.variant_id !== variantId))
  }

  const orderTotal = useMemo(() => lineItems.reduce((sum, li) => sum + toNumber(li.price) * li.quantity, 0).toFixed(2), [lineItems])

  async function handleSubmit() {
    if (!customerName.trim() || !customerPhone.trim()) { alert(copy.customerNamePhoneRequired); return }
    if (lineItems.length === 0) { alert(copy.addAtLeastOneProduct); return }
    const overStock = lineItems.find(li => li.quantity > li.available)
    if (overStock) {
      setOrderMessage({ type: 'error', text: lang === 'ar' ? `المتاح من ${overStock.title}: ${overStock.available}` : `${overStock.title}: only ${overStock.available} available.` })
      return
    }
    setSaving(true)
    setOrderMessage(null)
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
      if (res?.error) {
        const detail = Array.isArray(res?.details) && res.details[0] ? res.details[0] : null
        const msg = res.error === 'insufficient_inventory' && detail
          ? (lang === 'ar' ? `المتاح فقط: ${detail.available}` : `${detail.title || 'Item'}: only ${detail.available} available.`)
          : `${copy.errorPrefix}: ${res.error}`
        setOrderMessage({ type: 'error', text: msg })
        setSaving(false)
        return
      }
      setSuccess(res?.data)
    } catch (e: any) {
      alert(`${copy.failedPrefix}: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  async function downloadInvoice() {
    try {
      const canvas = await captureInvoiceCanvas()
      if (!canvas) return
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
    try {
      const canvas = await captureInvoiceCanvas()
      if (!canvas) return
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

  async function captureInvoiceCanvas() {
    if (!invoiceExportRef.current) return null
    const html2canvas = (await import('html2canvas')).default
    const sourceNode = invoiceExportRef.current
    const sandbox = document.createElement('div')
    sandbox.style.position = 'fixed'
    sandbox.style.left = '-20000px'
    sandbox.style.top = '0'
    sandbox.style.zIndex = '-1'
    sandbox.style.opacity = '0'
    sandbox.style.pointerEvents = 'none'
    sandbox.style.background = '#ffffff'

    const clone = sourceNode.cloneNode(true) as HTMLDivElement
    clone.style.transform = 'none'
    clone.style.width = `${desktopInvoiceWidth}px`
    clone.style.minWidth = `${desktopInvoiceWidth}px`

    sandbox.appendChild(clone)
    document.body.appendChild(sandbox)

    try {
      await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()))
      return await html2canvas(clone, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
        width: clone.scrollWidth,
        windowWidth: clone.scrollWidth,
      })
    } finally {
      sandbox.remove()
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
    ? 'px-3 py-4 text-base font-extrabold text-white'
    : 'px-3 py-3 text-sm font-bold uppercase tracking-[0.12em]'
  const invoiceTableCellClass = isArabic
    ? 'px-3 py-4 text-lg font-bold text-slate-800'
    : 'px-3 py-4 text-base font-semibold text-slate-700'
  const totalToPayLabel = isArabic ? 'المبلغ الواجب دفعه' : 'Total to pay'
  const arabicThankYou = 'شكراً لتعاملكم معنا'
  const desktopInvoiceWidth = 960
  const invoicePreviewTitle = isArabic ? '\u0645\u0639\u0627\u064a\u0646\u0629 \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629' : 'Invoice preview'
  const zoomOutLabel = isArabic ? '\u062a\u0635\u063a\u064a\u0631' : 'Zoom out'
  const zoomInLabel = isArabic ? '\u062a\u0643\u0628\u064a\u0631' : 'Zoom in'
  const fitLabel = isArabic ? '\u0645\u0644\u0621 \u0627\u0644\u0625\u0637\u0627\u0631' : 'Fit to screen'
  const previewScale = Math.min(Math.max(invoiceFitScale * invoiceZoom, 0.25), 3)
  const previewCanvasWidth = invoicePreviewSize.width * previewScale
  const previewCanvasHeight = invoicePreviewSize.height * previewScale

  useEffect(() => {
    if (!success) return
    setInvoiceZoom(1)
    setInvoicePreviewUrl(null)
  }, [success])

  useEffect(() => {
    if (!success) return
    let active = true
    setInvoicePreviewLoading(true)
    captureInvoiceCanvas()
      .then(canvas => {
        if (!active || !canvas) return
        setInvoicePreviewSize({ width: canvas.width, height: canvas.height })
        setInvoicePreviewUrl(canvas.toDataURL('image/png'))
      })
      .finally(() => {
        if (active) setInvoicePreviewLoading(false)
      })
    return () => { active = false }
  }, [success, lang])

  useEffect(() => {
    if (!success) return
    const viewportEl = invoicePreviewViewportRef.current
    if (!viewportEl) return

    const updateScale = () => {
      const nextWidth = invoicePreviewSize.width || desktopInvoiceWidth
      const nextHeight = invoicePreviewSize.height || 960
      const availableWidth = Math.max(viewportEl.clientWidth - 40, 1)
      const availableHeight = Math.max(viewportEl.clientHeight - 40, 1)
      const nextFitScale = Math.min(availableWidth / nextWidth, availableHeight / nextHeight, 1)
      setInvoiceFitScale(Math.max(nextFitScale, 0.25))
    }

    updateScale()
    const observer = new ResizeObserver(() => {
      window.requestAnimationFrame(updateScale)
    })
    observer.observe(viewportEl)
    return () => observer.disconnect()
  }, [success, desktopInvoiceWidth, invoicePreviewSize.width, invoicePreviewSize.height])

  if (success) {
    return (
      <div className="max-w-5xl mx-auto space-y-4 pb-16 animate-in">
        <div className="rounded-[28px] border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
          <div className="mb-3 flex items-center justify-between gap-3 px-1">
            <div>
              <p className="text-sm font-bold text-slate-900">{invoicePreviewTitle}</p>
              <p className="text-xs text-slate-500">{Math.round(previewScale * 100)}%</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setInvoiceZoom(prev => Math.max(0.6, Number((prev - 0.15).toFixed(2))))}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                aria-label={zoomOutLabel}
                title={zoomOutLabel}
              >
                <Minus size={16} />
              </button>
              <button
                onClick={() => setInvoiceZoom(1)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                {fitLabel}
              </button>
              <button
                onClick={() => setInvoiceZoom(prev => Math.min(2.6, Number((prev + 0.15).toFixed(2))))}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                aria-label={zoomInLabel}
                title={zoomInLabel}
              >
                <Plus size={16} />
              </button>
            </div>
          </div>

          <div
            ref={invoicePreviewViewportRef}
            className={`${invoiceZoom === 1 ? 'overflow-hidden' : 'overflow-auto'} rounded-[24px] border border-slate-200 bg-slate-100/70 p-3 h-[52dvh] min-h-[320px] max-h-[720px] sm:h-[60dvh]`}
          >
            {invoicePreviewLoading || !invoicePreviewUrl ? (
              <div className="flex h-full min-h-[240px] w-full items-center justify-center rounded-[20px] border border-slate-200 bg-white text-slate-400">
                <Loader2 className="animate-spin" size={22} />
              </div>
            ) : (
              <div className="flex min-h-full min-w-full items-center justify-center">
                <img
                  src={invoicePreviewUrl}
                  alt={invoicePreviewTitle}
                  className="max-w-none rounded-[20px] border border-slate-200 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.08)]"
                  style={{
                    width: `${previewCanvasWidth}px`,
                    minWidth: `${previewCanvasWidth}px`,
                    height: `${previewCanvasHeight}px`,
                    minHeight: `${previewCanvasHeight}px`,
                  }}
                />
              </div>
            )}
          </div>
        </div>

        <div className="fixed left-[-20000px] top-0 -z-10 opacity-0 pointer-events-none">
          <div
            ref={invoiceExportRef}
            dir={isArabic ? 'rtl' : 'ltr'}
            lang={isArabic ? 'ar' : 'en'}
            className="mx-auto overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.08)]"
            style={{ fontFamily: invoiceFontFamily, width: `${desktopInvoiceWidth}px`, minWidth: `${desktopInvoiceWidth}px` }}
          >
          <div className="grid min-h-[960px] grid-rows-[auto_minmax(420px,1fr)_auto]">
            <section className="grid grid-cols-[1.05fr_1fr_1fr] grid-rows-[auto_auto] gap-4 border-b border-slate-200 px-8 py-6">
              <div className="row-span-2 rounded-[24px] border border-slate-200 bg-slate-50 px-5 py-5">
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

              <div className="col-span-2 flex items-start justify-between gap-4 rounded-[24px] px-1 py-1">
                <div className={`${isArabic ? 'text-right' : 'text-left'}`}>
                  <p className="text-xl font-bold tracking-tight text-slate-950">{copy.brand}</p>
                  <p className={`mt-1 ${invoiceMutedTextClass}`}>{vendor.name}</p>
                  <p className={`mt-3 ${invoiceLabelClass}`}>{copy.invoice}</p>
                  <p className={`mt-1 ${isArabic ? 'text-3xl font-extrabold text-slate-950' : 'text-2xl font-bold text-slate-950'}`}>{invoiceNumber}</p>
                </div>
                <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-white">
                  <FileText size={18} />
                </div>
              </div>

              <div className="min-h-[118px] space-y-1 rounded-[22px] border border-slate-200 px-4 py-4">
                <p className={invoiceLabelClass}>{copy.billTo}</p>
                <p className={`${invoiceBodyTextClass} break-words`}>{customerName}</p>
                <p className={`${invoiceMutedTextClass} break-words`}>{customerPhone}</p>
                {customerAddressLine && <p className={`${invoiceMutedTextClass} break-words`}>{customerAddressLine}</p>}
              </div>

              <div className="min-h-[118px] space-y-1 rounded-[22px] border border-slate-200 px-4 py-4">
                <p className={invoiceLabelClass}>{copy.billFrom}</p>
                <p className={invoiceBodyTextClass}>{vendor.name}</p>
                <p className={invoiceMutedTextClass}>Wholesale</p>
                <p className={invoiceMutedTextClass}>Casablanca, Morocco</p>
              </div>
            </section>

            <section className="px-8 py-5">
              <div className="h-full min-h-[430px] overflow-hidden rounded-[22px] border border-slate-200">
                <table className="w-full border-collapse table-fixed">
                  <colgroup>
                    <col className="w-[7%]" />
                    <col className="w-[10%]" />
                    <col className="w-[45%]" />
                    <col className="w-[10%]" />
                    <col className="w-[14%]" />
                    <col className="w-[14%]" />
                  </colgroup>
                  <thead className="bg-slate-800 text-white">
                    <tr>
                      <th className={invoiceTableHeadClass}>#</th>
                      <th className={invoiceTableHeadClass}></th>
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
                          <div className="h-14 w-14 overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                            {li.image ? (
                              <img src={li.image} alt="" className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-slate-300"><Package size={18} /></div>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-4">
                          <p className={`${isArabic ? 'text-lg font-extrabold leading-8' : 'text-base font-bold leading-6'} text-slate-900 break-words`}>{li.title}</p>
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

            <section className="grid grid-cols-[1fr_320px] gap-5 border-t border-slate-200 px-8 py-6">
              <div className="min-h-[180px] rounded-[22px] border border-slate-200 px-5 py-4">
                <p className={invoiceLabelClass}>{copy.paymentNote}</p>
                <p className={`mt-4 ${invoiceMutedTextClass}`}>{copy.thankYou}</p>
                <p className={`mt-2 ${isArabic ? 'text-base font-extrabold text-slate-700' : 'text-sm font-bold text-slate-700'}`}>{arabicThankYou}</p>
                <p className={`mt-3 ${invoiceSmallMutedTextClass}`}>{totalItems} {copy.itemsLabel}</p>
              </div>

              <div className="min-h-[180px] rounded-[22px] border border-slate-200 bg-slate-50 px-5 py-4">
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

                <div className="mt-5 rounded-[20px] border-2 border-slate-950 bg-slate-950 px-5 py-4 text-white">
                  <p className={isArabic ? 'text-sm font-extrabold text-white/80 leading-6' : 'text-xs font-semibold uppercase tracking-[0.18em] text-white/70'}>{copy.total}</p>
                  <div className="mt-2 flex items-end justify-between gap-4">
                    <div>
                      <p className={`${isArabic ? 'text-lg font-extrabold leading-8' : 'text-sm font-semibold'} text-white`}>{totalToPayLabel}</p>
                      <p className="mt-1 text-xs font-semibold text-white/65">{invoiceDate}</p>
                    </div>
                    <p className={`${isArabic ? 'text-[2.4rem] font-extrabold leading-none' : 'text-3xl font-bold tracking-tight'} text-white`}>{formatDh(invoiceTotal, locale)}</p>
                  </div>
                </div>
              </div>
            </section>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <button onClick={downloadInvoice} className="col-span-1 sm:col-span-2 flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white py-3 rounded-2xl font-bold shadow-lg shadow-blue-200 transition-all active:scale-[0.98] text-sm">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            {copy.downloadInvoice}
          </button>
          <button onClick={shareInvoice} className="col-span-1 sm:col-span-2 flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white py-3 rounded-2xl font-bold shadow-lg shadow-emerald-200 transition-all active:scale-[0.98] text-sm">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
            {copy.shareInvoice}
          </button>
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
                    <p className={`text-[10px] font-bold ${v.inventory > 0 ? 'text-slate-400' : 'text-red-500'}`}>{v.inventory} {copy.inStock}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {orderMessage && (
          <div className={`mt-3 rounded-xl border px-4 py-3 text-xs font-bold ${orderMessage.type === 'error' ? 'border-red-200 bg-red-50 text-red-600' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
            {orderMessage.text}
          </div>
        )}

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
                  <button onClick={() => updateQty(li.variant_id, 1)} disabled={li.quantity >= li.available} className="w-7 h-7 rounded-lg bg-white border border-slate-200 flex items-center justify-center hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"><Plus size={14}/></button>
                </div>
                <button onClick={() => removeItem(li.variant_id)} className="text-red-400 hover:text-red-600 p-1"><Trash2 size={16}/></button>
                <p className="hidden">{li.available} available</p>
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

function OrdersTab({ vendor, products, initialOrders, copy, lang, onCreateOrder, onAddProduct }: { vendor: any; products: any[]; initialOrders: any[]; copy: AppCopy; lang: Lang; onCreateOrder?: () => void; onAddProduct?: () => void }) {
  const [orders, setOrders] = useState<any[]>(initialOrders || [])
  const [loading, setLoading] = useState(!(initialOrders || []).length)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'unpaid'|'newest'|'oldest'>('unpaid')
  const [customerFilter, setCustomerFilter] = useState('')
  const [expandedOrder, setExpandedOrder] = useState<string|null>(null)
  const [paymentModal, setPaymentModal] = useState<any>(null)
  const [payStatus, setPayStatus] = useState('unpaid')
  const [payAmount, setPayAmount] = useState('')
  const [payNote, setPayNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [cancelingOrderId, setCancelingOrderId] = useState<string | null>(null)
  const [updatingStatusOrderId, setUpdatingStatusOrderId] = useState<string | null>(null)
  const [ordersMessage, setOrdersMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const isArabic = lang === 'ar'
  const locale = getLocale(lang)
  const cancelLabels = {
    cancelOrder: isArabic ? 'إلغاء الطلب' : 'Cancel order',
    cancelled: isArabic ? 'ملغي' : 'Cancelled',
    confirm: isArabic ? 'هل تريد إلغاء هذا الطلب وإرجاع المخزون؟' : 'Cancel this order and restock inventory?',
    success: isArabic ? 'تم إلغاء الطلب وإرجاع المخزون' : 'Order cancelled and inventory restocked',
    failed: isArabic ? 'تعذر إلغاء الطلب' : 'Could not cancel order',
  }
  const workflowLabels: Record<string, string> = {
    new: copy.newStatus,
    processing: copy.processingStatus,
    fulfilled: copy.fulfilledStatus,
  }

  const productImageBySku = useMemo(() => {
    const map = new Map<string, string>()
    products.forEach((product: any) => {
      const image = getProductImageSrc(product)
      if (!image) return
      ;(product.variants || []).forEach((variant: any) => {
        const sku = String(variant.sku || '').trim()
        if (sku && !map.has(sku)) map.set(sku, image)
        if (variant.id && !map.has(String(variant.id))) map.set(String(variant.id), image)
      })
    })
    return map
  }, [products])

  function getOrderLineImage(lineItem: any) {
    const direct = lineItem?.image || lineItem?.image_url || lineItem?.product_image || lineItem?.variant_image
    if (direct) return direct
    const sku = String(lineItem?.sku || '').trim()
    if (sku && productImageBySku.get(sku)) return productImageBySku.get(sku) || ''
    const variantId = String(lineItem?.variant_id || '').trim()
    return variantId ? (productImageBySku.get(variantId) || '') : ''
  }

  function getOrderSkuSummary(order: any) {
    return (order.line_items || []).slice(0, 3).map((li: any) => {
      const sku = getDisplaySku(li.sku)
      const size = getDisplaySize(li.variant_title)
      return size && size !== '-' ? `${sku} ${size}` : sku
    })
  }

  async function fetchOrders() {
    if (!orders.length) setLoading(true)
    try {
      const res = await apiGet(`/api/wholesale/vendors/${vendor.id}/orders`)
      setOrders(res?.data?.all_orders || [])
    } catch { setOrders([]) }
    finally { setLoading(false) }
  }
  useEffect(() => { fetchOrders() }, [vendor.id])
  useEffect(() => {
    if (initialOrders?.length) {
      setOrders(initialOrders)
      setLoading(false)
    }
  }, [initialOrders])

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
        (o.line_items || []).some((li: any) =>
          (li.title || '').toLowerCase().includes(q) ||
          (li.sku || '').toLowerCase().includes(q) ||
          (li.variant_title || '').toLowerCase().includes(q)
        )
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

  async function cancelOrder(order: any) {
    if (order?.is_cancelled || order?.cancelled_at) return
    if (!window.confirm(cancelLabels.confirm)) return
    setCancelingOrderId(String(order.id))
    setOrdersMessage(null)
    try {
      const res = await apiPost(`/api/wholesale/vendors/${vendor.id}/orders/${order.id}/cancel`, { reason: 'customer' })
      if (res?.error) {
        setOrdersMessage({ type: 'error', text: `${cancelLabels.failed}: ${res.error}` })
        return
      }
      const cancelledAt = res?.data?.cancelled_at || new Date().toISOString()
      setOrders(prev => prev.map(o => o.id === order.id ? { ...o, is_cancelled: true, cancelled_at: cancelledAt, cancel_reason: res?.data?.cancel_reason || 'customer', payment_status: 'cancelled' } : o))
      setOrdersMessage({ type: 'success', text: cancelLabels.success })
    } catch (err: any) {
      setOrdersMessage({ type: 'error', text: `${cancelLabels.failed}: ${err?.message || err}` })
    } finally {
      setCancelingOrderId(null)
    }
  }

  async function updateOrderWorkflowStatus(order: any, nextStatus: 'processing' | 'fulfilled') {
    if (order?.is_cancelled || order?.cancelled_at) return
    setUpdatingStatusOrderId(String(order.id))
    setOrdersMessage(null)
    try {
      const res = await apiPatch(`/api/wholesale/vendors/${vendor.id}/orders/${order.id}/status`, {
        order_status: nextStatus,
      })
      if (res?.error) {
        setOrdersMessage({ type: 'error', text: `${copy.orderStatusUpdateFailed}: ${res.error}` })
        return
      }
      const data = res?.data || {}
      setOrders(prev => prev.map(o => o.id === order.id ? {
        ...o,
        order_status: data.order_status || nextStatus,
        order_status_updated_at: data.updated_at || new Date().toISOString(),
        fulfillment_warning: '',
      } : o))
      setOrdersMessage({ type: 'success', text: copy.orderStatusUpdated })
    } catch (err: any) {
      setOrdersMessage({ type: 'error', text: `${copy.orderStatusUpdateFailed}: ${err?.message || err}` })
    } finally {
      setUpdatingStatusOrderId(null)
    }
  }

  const statusBadge = (status: string) => {
    if (status === 'cancelled') return <span className="px-2.5 py-1 bg-slate-900 text-white text-[11px] font-bold rounded-full">{cancelLabels.cancelled}</span>
    if (status === 'paid') return <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 text-[11px] font-bold rounded-full">✓ Paid</span>
    if (status === 'partially_paid') return <span className="px-2.5 py-1 bg-amber-100 text-amber-700 text-[11px] font-bold rounded-full">◐ Partial</span>
    return <span className="px-2.5 py-1 bg-red-100 text-red-600 text-[11px] font-bold rounded-full">● Unpaid</span>
  }

  const orderStatusBadge = (status: string) => {
    if (status === 'cancelled') return <span className="px-2.5 py-1 bg-slate-900 text-white text-[11px] font-bold rounded-full">{cancelLabels.cancelled}</span>
    if (status === 'paid') return <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 text-[11px] font-bold rounded-full">✓ {copy.paid}</span>
    if (status === 'partially_paid') return <span className="px-2.5 py-1 bg-amber-100 text-amber-700 text-[11px] font-bold rounded-full">◐ {copy.partial}</span>
    return <span className="px-2.5 py-1 bg-red-100 text-red-600 text-[11px] font-bold rounded-full">● {copy.unpaid}</span>
  }

  const workflowStatusBadge = (status: string) => {
    if (status === 'cancelled') return <span className="px-2.5 py-1 bg-slate-900 text-white text-[11px] font-bold rounded-full">{cancelLabels.cancelled}</span>
    if (status === 'fulfilled') return <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 text-[11px] font-bold rounded-full">✓ {copy.fulfilledStatus}</span>
    if (status === 'processing') return <span className="px-2.5 py-1 bg-yellow-100 text-yellow-700 text-[11px] font-bold rounded-full">● {copy.processingStatus}</span>
    return <span className="px-2.5 py-1 bg-slate-100 text-slate-600 text-[11px] font-bold rounded-full">● {copy.newStatus}</span>
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold">{copy.ordersTitle}</h2>
          <p className="text-sm text-slate-500">{orders.length} {copy.totalOrdersLabel}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {onCreateOrder && (
            <button onClick={onCreateOrder} className="flex items-center gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white px-4 py-2.5 rounded-xl font-bold shadow-lg shadow-emerald-200/50 transition-all active:scale-[0.97] text-sm">
              <ShoppingCart size={18} />
              {copy.createOrder}
            </button>
          )}
          {onAddProduct && (
            <button onClick={onAddProduct} className="flex items-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white px-4 py-2.5 rounded-xl font-bold shadow-lg shadow-blue-200/50 transition-all active:scale-[0.97] text-sm">
              <PlusCircle size={18} />
              {copy.addProduct}
            </button>
          )}
          <button onClick={fetchOrders} className="p-2.5 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors">
            <RefreshCw size={18} className="text-slate-500" />
          </button>
        </div>
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

      {ordersMessage && (
        <div className={`rounded-xl border px-4 py-3 text-sm font-bold ${ordersMessage.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-600'}`}>
          {ordersMessage.text}
        </div>
      )}

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
            const orderCancelled = Boolean(order.is_cancelled || order.cancelled_at)
            const workflowStatus = orderCancelled ? 'cancelled' : (order.order_status || 'new')
            const imageSrc = getOrderLineImage((order.line_items || [])[0] || {})
            const skuSummary = getOrderSkuSummary(order)
            const previewItems = (order.line_items || []).slice(0, 3)
            return (
              <div key={order.id} className={`overflow-hidden rounded-[24px] border bg-white shadow-sm transition-all hover:shadow-md ${orderCancelled ? 'border-slate-300 opacity-80' : isExpanded ? 'border-blue-200 shadow-blue-100/60' : 'border-slate-200'}`}>
                <button onClick={() => setExpandedOrder(isExpanded ? null : String(order.id))}
                  className="w-full p-4 text-left">
                  <div className="flex items-start gap-3">
                    <div className="flex flex-shrink-0 -space-x-3">
                      {previewItems.length > 0 ? previewItems.map((li: any, i: number) => {
                        const src = getOrderLineImage(li)
                        return (
                          <div key={`${order.id}-thumb-${i}`} className="h-14 w-14 overflow-hidden rounded-2xl border-2 border-white bg-slate-100 shadow-sm">
                            {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : (
                              <div className="flex h-full w-full items-center justify-center text-slate-300"><Package size={20} /></div>
                            )}
                          </div>
                        )
                      }) : (
                        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-300"><ClipboardList size={22} /></div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-black text-blue-700">{order.name}</span>
                        {orderStatusBadge(orderCancelled ? 'cancelled' : order.payment_status)}
                        {!orderCancelled && workflowStatusBadge(workflowStatus)}
                      </div>
                      <p className="mt-2 truncate text-lg font-black text-slate-950">{order.customer_name || copy.customer}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {skuSummary.map((label: string, i: number) => (
                          <span key={`${order.id}-${label}-${i}`} className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-black text-slate-700">{label}</span>
                        ))}
                        {Number(order.units || 0) > 0 && (
                          <span className="rounded-full bg-blue-600 px-2 py-1 text-[11px] font-black text-white">{order.units} {copy.itemsLabel}</span>
                        )}
                      </div>
                      <p className="mt-2 text-[11px] font-bold text-slate-400">{new Date(order.created_at).toLocaleDateString(locale)}</p>
                    </div>
                    <div className={`${isArabic ? 'text-left' : 'text-right'} flex-shrink-0`}>
                      <p className="text-lg font-black text-slate-950">{formatDh(total, locale)}</p>
                      {order.payment_status === 'partially_paid' && (
                        <p className="text-[10px] font-black text-amber-600">{copy.remaining}: {formatDh(remaining, locale)}</p>
                      )}
                      <ChevronRight size={18} className={`mt-3 inline-block text-slate-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {previewItems.map((li: any, i: number) => (
                      <div key={`${order.id}-compact-${i}`} className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-black text-slate-950">{getDisplaySku(li.sku)}</p>
                          <p className="truncate text-xs font-bold text-slate-500">{getDisplaySize(li.variant_title)}</p>
                        </div>
                        <div className={`${isArabic ? 'text-left' : 'text-right'} ml-3`}>
                          <p className="text-[9px] font-black uppercase text-slate-400">{copy.qty}</p>
                          <p className="text-2xl font-black text-blue-600">{li.quantity}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="hidden">
                    {imageSrc ? (
                      <img src={imageSrc} alt={order.name || copy.ordersTitle} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-slate-300">
                        <ClipboardList size={42} />
                      </div>
                    )}
                    <div className="absolute right-3 top-3 rounded-full bg-white/90 p-2 shadow-sm">
                      <ChevronRight size={18} className={`text-slate-500 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                    </div>
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/75 to-transparent p-4">
                      <div className="flex items-end justify-between gap-3">
                        <div className="min-w-0 text-white">
                          <p className="truncate text-xl font-black leading-tight">{order.customer_name || copy.customer}</p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {skuSummary.map((label: string, i: number) => (
                              <span key={`${order.id}-${label}-${i}`} className="rounded-full bg-white/90 px-2 py-1 text-[11px] font-black text-slate-900">
                                {label}
                              </span>
                            ))}
                            {Number(order.units || 0) > 0 && (
                              <span className="rounded-full bg-blue-600 px-2 py-1 text-[11px] font-black text-white">
                                {order.units} {copy.itemsLabel}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className={`${isArabic ? 'text-left' : 'text-right'} rounded-2xl bg-white/95 px-3 py-2 text-slate-950 shadow-sm`}>
                          <p className="text-xl font-black leading-tight">{formatDh(total, locale)}</p>
                          {order.payment_status === 'partially_paid' && (
                            <p className="text-[10px] font-black text-amber-600">{copy.remaining}: {formatDh(remaining, locale)}</p>
                          )}
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-black text-blue-700">{order.name}</span>
                        {orderStatusBadge(orderCancelled ? 'cancelled' : order.payment_status)}
                        {!orderCancelled && workflowStatusBadge(workflowStatus)}
                        <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-bold text-white/85">{new Date(order.created_at).toLocaleDateString(locale)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="hidden">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm text-blue-600">{order.name}</span>
                      {orderStatusBadge(orderCancelled ? 'cancelled' : order.payment_status)}
                      {!orderCancelled && workflowStatusBadge(workflowStatus)}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      {order.customer_name} · {order.units} {copy.itemsLabel} · {new Date(order.created_at).toLocaleDateString(locale)}
                    </p>
                    <p className="hidden text-xs text-slate-500 mt-1">
                      {order.customer_name} · {order.units} items · {new Date(order.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="hidden">
                    <p className="font-bold text-sm">{formatDh(total, locale)}</p>
                    {order.payment_status === 'partially_paid' && (
                      <p className="text-[10px] text-amber-600 font-medium">{copy.remaining}: {formatDh(remaining, locale)}</p>
                    )}
                  </div>
                  <ChevronRight size={16} className={`hidden text-slate-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                </button>

                {/* Expanded Content */}
                {isExpanded && (
                  <div className="border-t border-slate-100 p-4 space-y-3 bg-slate-50/50">
                    {/* Line Items */}
                    <div className="space-y-2">
                      {(order.line_items || []).map((li: any, i: number) => (
                        <div key={i} className="flex items-center justify-between bg-white rounded-xl p-3 border border-slate-100">
                          <div className="flex-1 min-w-0">
                            <p className="truncate text-lg font-black text-slate-950">{getDisplaySku(li.sku)}</p>
                            <p className="truncate text-sm font-bold text-slate-500">{getDisplaySize(li.variant_title)}</p>
                          </div>
                          <div className={`${isArabic ? 'text-left' : 'text-right'} ml-3`}>
                            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{copy.qty}</p>
                            <p className="text-3xl font-black text-blue-600">{li.quantity}</p>
                          </div>
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
                    <div className="bg-white rounded-xl p-3 border border-slate-100">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{copy.orderWorkflowStatus}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {workflowStatusBadge(workflowStatus)}
                        {order.order_status_updated_at && (
                          <span className="text-[11px] font-semibold text-slate-400">{new Date(order.order_status_updated_at).toLocaleString(locale)}</span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <button onClick={() => updateOrderWorkflowStatus(order, 'processing')}
                        disabled={orderCancelled || workflowStatus === 'processing' || workflowStatus === 'fulfilled' || updatingStatusOrderId === String(order.id)}
                        className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-yellow-500 text-white text-sm font-bold rounded-xl hover:bg-yellow-600 transition-colors disabled:cursor-not-allowed disabled:opacity-45">
                        {updatingStatusOrderId === String(order.id) ? <Loader2 size={16} className="animate-spin" /> : <Clock size={16} />}
                        {workflowStatus === 'processing' ? workflowLabels.processing : copy.markProcessing}
                      </button>
                      <button onClick={() => updateOrderWorkflowStatus(order, 'fulfilled')}
                        disabled={orderCancelled || workflowStatus === 'fulfilled' || updatingStatusOrderId === String(order.id)}
                        className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-emerald-600 text-white text-sm font-bold rounded-xl hover:bg-emerald-700 transition-colors disabled:cursor-not-allowed disabled:opacity-45">
                        {updatingStatusOrderId === String(order.id) ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
                        {workflowStatus === 'fulfilled' ? workflowLabels.fulfilled : copy.markFulfilled}
                      </button>
                      <button onClick={() => openPaymentModal(order)}
                        disabled={orderCancelled}
                        className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-blue-600 text-white text-sm font-bold rounded-xl hover:bg-blue-700 transition-colors disabled:cursor-not-allowed disabled:opacity-45">
                        <CreditCard size={16} /> {copy.updatePayment}
                      </button>
                      <button onClick={() => cancelOrder(order)}
                        disabled={orderCancelled || cancelingOrderId === String(order.id)}
                        className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-slate-900 text-white text-sm font-bold rounded-xl hover:bg-slate-800 transition-colors disabled:cursor-not-allowed disabled:opacity-45">
                        {cancelingOrderId === String(order.id) ? <Loader2 size={16} className="animate-spin" /> : <X size={16} />}
                        {orderCancelled ? cancelLabels.cancelled : cancelLabels.cancelOrder}
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
  const [expandedCustomerKey, setExpandedCustomerKey] = useState('')
  const isArabic = lang === 'ar'
  const locale = isArabic ? 'ar-MA' : 'en-GB'

  async function fetchCustomers() {
    setLoading(true)
    try {
      const res = await apiGet(`/api/wholesale/vendors/${vendor.id}/customers`)
      const list = res?.data?.customers || []
      setCustomers(list)
      setTotalUnpaid(Number(res?.data?.total_unpaid || 0))
      setExpandedCustomerKey((prev: string) => {
        if (prev && list.some((c: any) => c.key === prev)) return prev
        return ''
      })
    } catch {
      setCustomers([])
      setTotalUnpaid(0)
      setExpandedCustomerKey('')
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
        <div className="space-y-3">
          {filteredCustomers.map((c: any) => {
            const isExpanded = c.key === expandedCustomerKey
            return (
              <div key={c.key} className={`overflow-hidden rounded-2xl border transition-all ${isExpanded ? 'border-blue-200 bg-blue-50/40 shadow-sm' : 'border-slate-200 bg-white hover:shadow-md'}`}>
                <button
                  onClick={() => setExpandedCustomerKey(isExpanded ? '' : c.key)}
                  className="w-full p-4 text-left"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-bold text-sm truncate">{c.customer_name || copy.notAvailable}</p>
                      <p className="text-[11px] text-slate-500 truncate">{c.customer_phone || copy.noPhone}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="text-[11px] font-semibold px-2 py-1 rounded-full bg-slate-100 text-slate-600">
                          {c.orders_count} {copy.ordersCountLabel}
                        </p>
                        <p className={`mt-2 text-sm font-bold ${Number(c.total_unpaid || 0) > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                          {formatDh(Number(c.total_unpaid || 0), locale)}
                        </p>
                      </div>
                      <ChevronRight size={16} className={`text-slate-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                    </div>
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-slate-100 bg-slate-50/70 p-4 space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-bold">{c.customer_name || copy.notAvailable}</h3>
                        <p className="text-sm text-slate-500">{c.customer_phone || copy.noPhone}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[11px] text-slate-500">{copy.unpaidTotal}</p>
                        <p className={`text-lg font-bold ${Number(c.total_unpaid || 0) > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                          {formatDh(Number(c.total_unpaid || 0), locale)}
                        </p>
                      </div>
                    </div>

                    {(c.orders || []).length === 0 ? (
                      <p className="text-sm text-slate-500">{copy.noOrdersForCustomer}</p>
                    ) : (
                      <div className="space-y-2">
                        {(c.orders || []).map((o: any) => {
                          const total = Number(o.total_price || 0)
                          const paid = Number(o.amount_paid || 0)
                          const pending = Number(o.pending_amount || 0)
                          return (
                            <div key={o.id} className="rounded-xl border border-slate-200 bg-white p-3">
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
                                  <p className="font-bold text-slate-700">{formatDh(total, locale)}</p>
                                </div>
                                <div className="rounded-lg bg-emerald-50 p-2 border border-emerald-100">
                                  <p className="text-emerald-700">{copy.paid}</p>
                                  <p className="font-bold text-emerald-700">{formatDh(paid, locale)}</p>
                                </div>
                                <div className="rounded-lg bg-red-50 p-2 border border-red-100">
                                  <p className="text-red-600">{copy.pending}</p>
                                  <p className="font-bold text-red-600">{formatDh(pending, locale)}</p>
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
            )
          })}
        </div>
      )}
    </div>
  )
}
