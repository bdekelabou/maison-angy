const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Helper to read DB
function readDb() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = fs.readFileSync(DATA_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Error reading db:', err);
  }
  return {
    settings: {
      storeName: 'Maison Angy',
      slogan: 'Mode & Élégance au Féminin',
      currency: 'FCFA',
      whatsappCountryCode: '228',
      whatsappNumber: '93849200',
      fullWhatsapp: '22893849200',
      initialCash: 81500,
      currentCash: 81500
    },
    products: [],
    orders: [],
    deliveryPersons: [],
    trips: [],
    cashTransactions: []
  };
}

// Helper to write DB
function saveDb(db) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('Error writing db:', err);
    return false;
  }
}

// Recalculate cash balance from transactions
function recalculateCash(db) {
  let running = 0;
  // Sort chronologically
  db.cashTransactions.sort((a, b) => (a.dateTime || '').localeCompare(b.dateTime || ''));
  
  db.cashTransactions.forEach(t => {
    running += (t.encaissement || 0) + (t.depot || 0) - (t.retrait || 0) + (t.ecart || 0);
  });
  db.settings.currentCash = running;
  return running;
}

// Compute key performance statistics
function computeStats(db) {
  const totalSales = db.orders
    .filter(o => o.status === 'LIVRE' || o.paymentStatus === 'PAYE')
    .reduce((sum, o) => sum + (o.totalOrder || 0), 0);

  const totalGrossMargin = db.orders
    .filter(o => o.status === 'LIVRE' || o.paymentStatus === 'PAYE')
    .reduce((sum, o) => sum + (o.marginGross || 0), 0);

  const totalNetMargin = db.orders
    .filter(o => o.status === 'LIVRE' || o.paymentStatus === 'PAYE')
    .reduce((sum, o) => sum + (o.marginNet || 0), 0);

  const pendingOrders = db.orders.filter(o => o.status !== 'LIVRE' && o.status !== 'ANNULE').length;
  const lowStockCount = db.products.filter(p => p.stock <= (p.minStockAlert || 3)).length;
  const totalStockValue = db.products.reduce((sum, p) => sum + (p.stock * p.costPrice), 0);
  const totalPotentialSale = db.products.reduce((sum, p) => sum + (p.stock * (p.isPromo ? p.promoPrice : p.salePrice)), 0);

  return {
    totalSales,
    totalGrossMargin,
    totalNetMargin,
    pendingOrders,
    lowStockCount,
    totalStockValue,
    totalPotentialSale,
    currentCash: db.settings.currentCash || 81500,
    productCount: db.products.length,
    orderCount: db.orders.length
  };
}

// Helper to parse JSON body
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

// MIME types
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  let pathname = parsedUrl.pathname;

  // CORS headers for convenience
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // --- API ROUTES ---
  if (pathname.startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const db = readDb();

    // POST /api/login (Multi-User Authentication: Admin or Gérante)
    if (pathname === '/api/login' && req.method === 'POST') {
      const data = await parseBody(req);
      const userPhone = (data.username || data.phone || '').toString().trim().replace(/[^0-9]/g, '');
      const userPass = (data.password || '').toString().trim();

      const users = db.users || [
        { id: 1, name: "Ange Ines", phone: "93849200", password: "password2026", role: "ADMIN", roleLabel: "Propriétaire & Administratrice" }
      ];

      // Match either by phone and password in users list, or fallback to admin settings
      const found = users.find(u => {
        const uClean = (u.phone || '').toString().trim().replace(/[^0-9]/g, '');
        return uClean === userPhone && u.password === userPass;
      });

      if (found) {
        res.writeHead(200);
        res.end(JSON.stringify({
          success: true,
          token: 'angy_token_' + found.id + '_' + Date.now(),
          user: {
            id: found.id,
            name: found.name,
            phone: found.phone,
            role: found.role,
            roleLabel: found.roleLabel || (found.role === 'ADMIN' ? 'Propriétaire' : 'Gérante'),
            permissions: found.permissions || (found.role === 'ADMIN' ? {
              products: true, orders: true, delivery: true, trips: true, cash: true, profits: true, settings: true, team: true
            } : {
              products: true, orders: true, delivery: true, trips: false, cash: false, profits: false, settings: false, team: false
            })
          }
        }));
      } else if (userPhone === (db.settings.adminUsername || '93849200').replace(/[^0-9]/g, '') && userPass === (db.settings.adminPassword || 'password2026')) {
        res.writeHead(200);
        res.end(JSON.stringify({
          success: true,
          token: 'angy_token_admin_' + Date.now(),
          user: {
            id: 1,
            name: "Ange Ines",
            phone: db.settings.adminUsername || "93849200",
            role: "ADMIN",
            roleLabel: "Propriétaire & Administratrice"
          }
        }));
      } else {
        res.writeHead(401);
        res.end(JSON.stringify({
          success: false,
          error: 'Numéro ou mot de passe incorrect.'
        }));
      }
      return;
    }

    // --- USERS MANAGEMENT (Admin creates / manages Gérantes) ---
    if (pathname === '/api/users' && req.method === 'GET') {
      res.writeHead(200);
      res.end(JSON.stringify(db.users || []));
      return;
    }

    if (pathname === '/api/users' && req.method === 'POST') {
      const data = await parseBody(req);
      if (!db.users) db.users = [];
      const newUser = {
        id: db.users.length > 0 ? Math.max(...db.users.map(u => u.id)) + 1 : 1,
        name: data.name || 'Nouvelle Gérante',
        phone: (data.phone || '').toString().trim().replace(/[^0-9]/g, ''),
        password: data.password || 'gerante2026',
        role: data.role || 'GERANTE',
        roleLabel: data.roleLabel || (data.role === 'ADMIN' ? 'Propriétaire' : 'Gérante Boutique'),
        permissions: data.permissions || (data.role === 'ADMIN' ? {
          products: true, orders: true, delivery: true, trips: true, cash: true, profits: true, settings: true, team: true
        } : {
          products: true, orders: true, delivery: true, trips: false, cash: false, profits: false, settings: false, team: false
        }),
        createdAt: new Date().toISOString().split('T')[0]
      };
      db.users.push(newUser);
      saveDb(db);
      res.writeHead(201);
      res.end(JSON.stringify({ success: true, user: newUser }));
      return;
    }

    if (pathname.startsWith('/api/users/') && req.method === 'PUT') {
      const id = parseInt(pathname.split('/')[3]);
      const data = await parseBody(req);
      if (!db.users) db.users = [];
      const idx = db.users.findIndex(u => u.id === id);
      if (idx !== -1) {
        // Prevent changing master admin role to non-admin
        if (db.users[idx].role === 'ADMIN' && data.role && data.role !== 'ADMIN') {
          delete data.role;
        }
        db.users[idx] = { ...db.users[idx], ...data, id };
        saveDb(db);
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, user: db.users[idx] }));
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'User not found' }));
      }
      return;
    }

    if (pathname.startsWith('/api/users/') && req.method === 'DELETE') {
      const id = parseInt(pathname.split('/')[3]);
      if (!db.users) db.users = [];
      const userToDelete = db.users.find(u => u.id === id);
      if (userToDelete && userToDelete.role === 'ADMIN') {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Impossible de supprimer le compte Propriétaire principal.' }));
        return;
      }
      db.users = db.users.filter(u => u.id !== id);
      saveDb(db);
      res.writeHead(200);
      res.end(JSON.stringify({ success: true }));
      return;
    }

    // GET /api/all or /api/data
    if ((pathname === '/api/all' || pathname === '/api/data') && req.method === 'GET') {
      recalculateCash(db);
      res.writeHead(200);
      res.end(JSON.stringify({
        settings: db.settings,
        products: db.products,
        orders: db.orders,
        deliveryPersons: db.deliveryPersons,
        trips: db.trips,
        cashTransactions: db.cashTransactions.slice(-50), // last 50
        cashCount: db.cashTransactions.length,
        users: db.users || [],
        stats: computeStats(db)
      }));
      return;
    }

    // GET /api/stats
    if (pathname === '/api/stats' && req.method === 'GET') {
      res.writeHead(200);
      res.end(JSON.stringify(computeStats(db)));
      return;
    }

    // --- PRODUCTS ---
    if (pathname === '/api/products' && req.method === 'GET') {
      res.writeHead(200);
      res.end(JSON.stringify(db.products));
      return;
    }

    if (pathname === '/api/products' && req.method === 'POST') {
      const data = await parseBody(req);
      const rawImages = Array.isArray(data.images) ? data.images.map(img => (img || '').trim()).filter(Boolean) : [];
      if (rawImages.length === 0 && data.image) {
        rawImages.push(data.image.trim());
      }
      if (rawImages.length === 0) {
        rawImages.push('https://images.unsplash.com/photo-1582533561751-ef6f6ab93a2e?w=500&auto=format&fit=crop&q=80');
      }
      let coverIndex = parseInt(data.coverIndex);
      if (isNaN(coverIndex) || coverIndex < 0 || coverIndex >= rawImages.length) {
        coverIndex = 0;
      }
      const coverImage = rawImages[coverIndex] || rawImages[0];

      const newProduct = {
        id: db.products.length > 0 ? Math.max(...db.products.map(p => p.id)) + 1 : 1,
        name: data.name || 'Nouvel Article',
        category: data.category || 'Général',
        costPrice: parseFloat(data.costPrice) || 0,
        salePrice: parseFloat(data.salePrice) || 0,
        promoPrice: parseFloat(data.promoPrice) || 0,
        isPromo: Boolean(data.isPromo),
        isFeatured: Boolean(data.isFeatured),
        published: data.published !== false,
        stock: parseInt(data.stock) || 0,
        minStockAlert: parseInt(data.minStockAlert) || 3,
        description: data.description || '',
        image: coverImage,
        images: rawImages,
        coverIndex: coverIndex,
        available: data.available !== false
      };
      db.products.push(newProduct);
      saveDb(db);
      res.writeHead(201);
      res.end(JSON.stringify({ success: true, product: newProduct }));
      return;
    }

    if (pathname.startsWith('/api/products/') && req.method === 'PUT') {
      const id = parseInt(pathname.split('/')[3]);
      const data = await parseBody(req);
      const idx = db.products.findIndex(p => p.id === id);
      if (idx !== -1) {
        let updated = { ...db.products[idx], ...data, id };
        if (Array.isArray(data.images)) {
          const cleanImages = data.images.map(i => (i || '').trim()).filter(Boolean);
          if (cleanImages.length > 0) {
            updated.images = cleanImages;
            let coverIndex = parseInt(data.coverIndex);
            if (isNaN(coverIndex) || coverIndex < 0 || coverIndex >= cleanImages.length) {
              coverIndex = 0;
            }
            updated.coverIndex = coverIndex;
            updated.image = cleanImages[coverIndex];
          }
        } else if (data.image) {
          updated.image = data.image.trim();
          if (!updated.images || updated.images.length === 0) {
            updated.images = [updated.image];
            updated.coverIndex = 0;
          }
        }
        db.products[idx] = updated;
        saveDb(db);
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, product: db.products[idx] }));
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Product not found' }));
      }
      return;
    }

    if (pathname.startsWith('/api/products/') && req.method === 'DELETE') {
      const id = parseInt(pathname.split('/')[3]);
      db.products = db.products.filter(p => p.id !== id);
      saveDb(db);
      res.writeHead(200);
      res.end(JSON.stringify({ success: true }));
      return;
    }

    // --- ORDERS ---
    if (pathname === '/api/orders' && req.method === 'GET') {
      res.writeHead(200);
      res.end(JSON.stringify(db.orders));
      return;
    }

    // CREATE ORDER (From Client Store or Admin)
    if (pathname === '/api/orders' && req.method === 'POST') {
      const data = await parseBody(req);
      const orderId = 'CMD-' + new Date().getFullYear() + '-' + String(db.orders.length + 1).padStart(3, '0');
      
      const items = (data.items || []).map(item => {
        const prod = db.products.find(p => p.id === item.productId);
        const unitCost = prod ? prod.costPrice : 0;
        const unitPrice = item.unitPrice || (prod ? (prod.isPromo ? prod.promoPrice : prod.salePrice) : 0);
        const qty = parseInt(item.quantity) || 1;
        return {
          productId: item.productId,
          productName: item.productName || (prod ? prod.name : 'Article'),
          quantity: qty,
          unitPrice: unitPrice,
          costPrice: unitCost,
          total: unitPrice * qty
        };
      });

      const totalItems = items.reduce((sum, it) => sum + it.total, 0);
      const deliveryFee = parseFloat(data.deliveryFee) || 0;
      const totalOrder = totalItems + (data.deliveryFeePayer === 'CLIENT' ? deliveryFee : 0);
      const totalCost = items.reduce((sum, it) => sum + (it.costPrice * it.quantity), 0);
      const marginGross = totalItems - totalCost;
      const marginNet = marginGross - (data.deliveryFeePayer === 'BOUTIQUE' ? deliveryFee : 0);

      const newOrder = {
        id: orderId,
        customerName: data.customerName || 'Cliente Maison Angy',
        customerPhone: data.customerPhone || '',
        customerAddress: data.customerAddress || '',
        deliveryMode: data.deliveryMode || 'LIVRAISON_DOMICILE',
        deliveryFee: deliveryFee,
        deliveryFeePayer: data.deliveryFeePayer || 'CLIENT',
        deliveryPersonId: data.deliveryPersonId || null,
        deliveryPersonName: data.deliveryPersonName || '',
        deliveryPersonPhone: data.deliveryPersonPhone || '',
        status: data.status || 'A_PREPARER',
        paymentStatus: data.paymentStatus || 'A_LA_LIVRAISON',
        paymentMethod: data.paymentMethod || 'ESPECES',
        items: items,
        totalItems,
        totalOrder,
        marginGross,
        marginNet,
        createdAt: new Date().toISOString().replace('T', ' ').substring(0, 19),
        notes: data.notes || ''
      };

      // Deduct stock if order confirmed
      items.forEach(it => {
        const p = db.products.find(prod => prod.id === it.productId);
        if (p) {
          p.stock = Math.max(0, p.stock - it.quantity);
        }
      });

      db.orders.unshift(newOrder); // newest first
      saveDb(db);
      res.writeHead(201);
      res.end(JSON.stringify({ success: true, order: newOrder }));
      return;
    }

    // UPDATE ORDER (Assign delivery person, change status, validate payment)
    if (pathname.startsWith('/api/orders/') && req.method === 'PUT') {
      const orderId = pathname.split('/')[3];
      const data = await parseBody(req);
      const idx = db.orders.findIndex(o => o.id === orderId);
      if (idx !== -1) {
        const oldOrder = db.orders[idx];
        const updated = { ...oldOrder, ...data };

        // If status changed to LIVRE or payment changed to PAYE and wasn't before
        if (data.status === 'LIVRE' && oldOrder.status !== 'LIVRE') {
          updated.paymentStatus = 'PAYE';
          // Auto record into cash register!
          const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 19);
          db.cashTransactions.push({
            id: db.cashTransactions.length + 1,
            dateTime: nowStr,
            user: 'Ange Ines',
            retrait: 0,
            depot: 0,
            encaissement: updated.totalOrder,
            creditClient: '',
            ecart: 0,
            total: 0,
            commentaires: 'Vente ' + updated.id + ' - ' + updated.customerName + ' (' + updated.items.map(i => i.productName).join(', ') + ')'
          });
          recalculateCash(db);
        }

        // If cancelled, restore stock
        if (data.status === 'ANNULE' && oldOrder.status !== 'ANNULE') {
          oldOrder.items.forEach(it => {
            const p = db.products.find(prod => prod.id === it.productId);
            if (p) p.stock += it.quantity;
          });
        }

        db.orders[idx] = updated;
        saveDb(db);
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, order: updated }));
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Order not found' }));
      }
      return;
    }

    // --- DELIVERY PERSONS ---
    if (pathname === '/api/delivery-persons' && req.method === 'GET') {
      res.writeHead(200);
      res.end(JSON.stringify(db.deliveryPersons));
      return;
    }

    if (pathname === '/api/delivery-persons' && req.method === 'POST') {
      const data = await parseBody(req);
      const newDP = {
        id: db.deliveryPersons.length > 0 ? Math.max(...db.deliveryPersons.map(d => d.id)) + 1 : 1,
        name: data.name || 'Nouveau Livreur',
        phone: data.phone || '',
        zone: data.zone || 'Ville',
        status: data.status || 'Actif'
      };
      db.deliveryPersons.push(newDP);
      saveDb(db);
      res.writeHead(201);
      res.end(JSON.stringify({ success: true, deliveryPerson: newDP }));
      return;
    }

    if (pathname.startsWith('/api/delivery-persons/') && req.method === 'PUT') {
      const id = parseInt(pathname.split('/')[3]);
      const data = await parseBody(req);
      const idx = db.deliveryPersons.findIndex(d => d.id === id);
      if (idx !== -1) {
        db.deliveryPersons[idx] = { ...db.deliveryPersons[idx], ...data, id };
        saveDb(db);
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, deliveryPerson: db.deliveryPersons[idx] }));
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Delivery person not found' }));
      }
      return;
    }

    if (pathname.startsWith('/api/delivery-persons/') && req.method === 'DELETE') {
      const id = parseInt(pathname.split('/')[3]);
      db.deliveryPersons = db.deliveryPersons.filter(d => d.id !== id);
      saveDb(db);
      res.writeHead(200);
      res.end(JSON.stringify({ success: true }));
      return;
    }

    // --- TRIPS (DÉPLACEMENTS & FRAIS) ---
    if (pathname === '/api/trips' && req.method === 'GET') {
      res.writeHead(200);
      res.end(JSON.stringify(db.trips));
      return;
    }

    if (pathname === '/api/trips' && req.method === 'POST') {
      const data = await parseBody(req);
      const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 19);
      const cost = parseFloat(data.cost) || 0;
      const newTrip = {
        id: db.trips.length > 0 ? Math.max(...db.trips.map(t => t.id)) + 1 : 1,
        dateTime: nowStr,
        description: data.description || 'Frais de transport / Déplacement',
        cost: cost,
        transportType: data.transportType || 'TAXI_MOTO',
        relatedSupplierOrder: data.relatedSupplierOrder || '',
        notes: data.notes || ''
      };
      db.trips.unshift(newTrip);

      // Record in cash register as withdrawal
      db.cashTransactions.push({
        id: db.cashTransactions.length + 1,
        dateTime: nowStr,
        user: 'Ange Ines',
        retrait: cost,
        depot: 0,
        encaissement: 0,
        creditClient: '',
        ecart: 0,
        total: 0,
        commentaires: 'Déplacement: ' + newTrip.description
      });
      recalculateCash(db);
      saveDb(db);

      res.writeHead(201);
      res.end(JSON.stringify({ success: true, trip: newTrip }));
      return;
    }

    // --- CASH TRANSACTIONS (CAISSE) ---
    if (pathname === '/api/cash' && req.method === 'GET') {
      res.writeHead(200);
      res.end(JSON.stringify({
        currentCash: db.settings.currentCash,
        transactions: db.cashTransactions
      }));
      return;
    }

    if (pathname === '/api/cash' && req.method === 'POST') {
      const data = await parseBody(req);
      const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 19);
      const newTx = {
        id: db.cashTransactions.length + 1,
        dateTime: nowStr,
        user: data.user || 'Ange Ines',
        retrait: parseFloat(data.retrait) || 0,
        depot: parseFloat(data.depot) || 0,
        encaissement: parseFloat(data.encaissement) || 0,
        creditClient: data.creditClient || '',
        ecart: parseFloat(data.ecart) || 0,
        total: 0,
        commentaires: data.commentaires || ''
      };
      db.cashTransactions.push(newTx);
      recalculateCash(db);
      saveDb(db);
      res.writeHead(201);
      res.end(JSON.stringify({ success: true, transaction: newTx, currentCash: db.settings.currentCash }));
      return;
    }

    // --- SETTINGS ---
    if (pathname === '/api/settings' && req.method === 'GET') {
      res.writeHead(200);
      res.end(JSON.stringify(db.settings));
      return;
    }

    if (pathname === '/api/settings' && req.method === 'POST') {
      const data = await parseBody(req);
      db.settings = { ...db.settings, ...data };
      if (data.whatsappNumber) {
        const clean = data.whatsappNumber.replace(/[^0-9]/g, '');
        const code = (data.whatsappCountryCode || db.settings.whatsappCountryCode || '228').replace(/[^0-9]/g, '');
        db.settings.fullWhatsapp = code + clean;
      }
      saveDb(db);
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, settings: db.settings }));
      return;
    }

    // 404 for unknown API
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Endpoint not found' }));
    return;
  }

  // --- STATIC FILES ---
  if (pathname === '/' || pathname === '/index.html') {
    pathname = '/index.html';
  } else if (pathname === '/admin' || pathname === '/admin.html') {
    pathname = '/admin.html';
  }

  const filePath = path.join(PUBLIC_DIR, pathname);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>404 Non trouvé</h1><p>Page introuvable sur Maison Angy.</p>');
      } else {
        res.writeHead(500);
        res.end('Erreur serveur: ' + err.code);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('==================================================');
  console.log('  MAISON ANGY - SERVEUR OPERATIONNEL');
  console.log('  Site Vitrine Client : http://localhost:' + PORT);
  console.log('  Back-Office Admin   : http://localhost:' + PORT + '/admin');
  console.log('==================================================');
});
