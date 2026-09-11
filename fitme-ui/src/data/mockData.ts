const u = (id: string, w = 600, h = 800) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&h=${h}&q=80`;

export type Product = {
  id: string;
  title: string;
  brand: string;
  price: string;
  image: string;
  category: string;
};

export const trendingProducts: Product[] = [
  { id: 'p1', title: 'Linen Pleated Trouser', brand: 'Reverie', price: '$148', image: u('photo-1490481651871-ab68de25d43d'), category: 'Bottoms' },
  { id: 'p2', title: 'Silk Slip Midi Dress', brand: 'Maison Cléo', price: '$320', image: u('photo-1483985988355-763728e1935b'), category: 'Dresses' },
  { id: 'p3', title: 'Oversized Wool Blazer', brand: 'Studio Nicholson', price: '$485', image: u('photo-1591047139829-d91aecb6caea'), category: 'Outerwear' },
  { id: 'p4', title: 'Pointelle Knit Tank', brand: 'Toteme', price: '$190', image: u('photo-1539109136881-3be0616acf4b'), category: 'Tops' },
  { id: 'p5', title: 'Wide-Leg Denim', brand: 'Agolde', price: '$228', image: u('photo-1542272604-787c3835535d'), category: 'Bottoms' },
  { id: 'p6', title: 'Cashmere Cardigan', brand: 'The Row', price: '$890', image: u('photo-1434389677669-e08b4cac3105'), category: 'Knitwear' },
];

export const savedLooks = [
  { id: 'l1', title: 'Sunset in Lisbon', image: u('photo-1469334031218-e382a71b716b'), date: '2 days ago' },
  { id: 'l2', title: 'Office Soft Power', image: u('photo-1496747611176-843222e1e57c'), date: '5 days ago' },
  { id: 'l3', title: 'Weekend Linen', image: u('photo-1515886657613-9f3515b0c78f'), date: '1 week ago' },
  { id: 'l4', title: 'Evening Silk', image: u('photo-1483985988355-763728e1935b'), date: '2 weeks ago' },
];

export const inspirationFeed = [
  u('photo-1469334031218-e382a71b716b', 500, 700),
  u('photo-1496747611176-843222e1e57c', 500, 600),
  u('photo-1515886657613-9f3515b0c78f', 500, 800),
  u('photo-1485968579580-b6d095142e6e', 500, 650),
  u('photo-1483985988355-763728e1935b', 500, 700),
  u('photo-1539109136881-3be0616acf4b', 500, 600),
];

export const supportedPlatforms = ['Myntra', 'AJIO', 'Amazon', 'H&M', 'Nykaa', 'Meesho'];

export const fashionTips = [
  'Structured blazers pair beautifully with wide-leg trousers.',
  'Neutral accessories increase outfit versatility.',
  'One tactile accent elevates a minimalist palette.',
  'Tonal layering reads more elegant than contrast.',
  'Tailored shoulders balance a relaxed silhouette.',
];

export const currentLookContext = {
  product: 'Silk Slip Midi Dress',
  brand: 'Maison Cléo',
  category: 'Evening',
};

export const avaContextChips = [
  'Accessories for this look',
  'Best shoes to pair',
  'Handbag pairings',
  'Occasions to wear it',
  'Styling tips',
];

export const historyItems = [
  { id: 'h1', title: 'Linen Pleated Trouser', brand: 'Reverie', date: '3 days ago', image: u('photo-1490481651871-ab68de25d43d') },
  { id: 'h2', title: 'Silk Slip Midi Dress', brand: 'Maison Cléo', date: '3 days ago', image: u('photo-1483985988355-763728e1935b') },
  { id: 'h3', title: 'Oversized Wool Blazer', brand: 'Studio Nicholson', date: '3 days ago', image: u('photo-1591047139829-d91aecb6caea') },
  { id: 'h4', title: 'Pointelle Knit Tank', brand: 'Toteme', date: '3 days ago', image: u('photo-1539109136881-3be0616acf4b') },
  { id: 'h5', title: 'Wide-Leg Denim', brand: 'Agolde', date: '3 days ago', image: u('photo-1542272604-787c3835535d') },
  { id: 'h6', title: 'Cashmere Cardigan', brand: 'The Row', date: '3 days ago', image: u('photo-1434389677669-e08b4cac3105') },
];
