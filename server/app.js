const express = require('express');
const fs = require('fs');
const path = require('path');
const hbs = require('hbs');
const MySQL = require('./utilsMySQL');
const app = express();
const port = process.env.PORT || 3000;
// Detectar si estem al Proxmox (si és pm2)
const isProxmox = !!process.env.PM2_HOME;

// Iniciar connexió MySQL - CAMBIAT A 'minierp'
const db = new MySQL();
if (!isProxmox) {
  db.init({
    host: '127.0.0.1',
    port: 3306,
    user: 'super',
    password: '1234',
    database: 'minierp'  // ← CANVIAT
  });
} else {
  db.init({
    host: '127.0.0.1',
    port: 3306,
    user: 'super',
    password: '1234',
    database: 'minierp'  // ← CANVIAT
  });
}

// Static files
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.urlencoded({ extended: true }));

// Disable cache
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  next();
});

// Handlebars
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'hbs');

// Registrar Helpers HBS - AFEGITS NOU
hbs.registerHelper('eq', (a, b) => a == b);
hbs.registerHelper('gt', (a, b) => parseInt(a) > parseInt(b));
hbs.registerHelper('lt', (a, b) => parseInt(a) < parseInt(b));
hbs.registerHelper('suma', (a, b) => parseInt(a) + parseInt(b));
hbs.registerHelper('resta', (a, b) => parseInt(a) - parseInt(b));

// Partials de Handlebars
hbs.registerPartials(path.join(__dirname, 'views', 'partials'));

// HELPER COMÚ PER DADES COMUNIQUES
function getCommonData() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'common.json'), 'utf8'));
  } catch {
    return {};
  }
}

// ==================== DASHBOARD ====================
app.get('/', async (req, res) => {
  try {
    const avui = new Date().toISOString().slice(0,10);
    const mesAny = new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2,'0') + '%';
    
    const [kpiAvui, kpiMes, stockBaix, ultimesVendes, topProductes] = await Promise.all([
      db.query(`SELECT COUNT(*) as total FROM sales WHERE DATE(sale_date)=${avui}`),
      db.query(`SELECT COUNT(*) as total FROM sales WHERE sale_date LIKE '${mesAny}'`),
      db.query(`SELECT name, stock FROM products WHERE stock <= 5`),
      db.query(`SELECT s.id, DATE(s.sale_date) as data, c.name as client, s.total FROM sales s JOIN customers c ON s.customer_id=c.id ORDER BY s.sale_date DESC LIMIT 5`),
      db.query(`SELECT p.name, SUM(si.qty) as total_vendut FROM sale_items si JOIN products p ON si.product_id=p.id GROUP BY p.id ORDER BY total_vendut DESC LIMIT 5`)
    ]);

    const data = {
      kpi: {
        vendesAvui: kpiAvui[0].total,
        vendesMes: kpiMes[0].total,
        comandesAvui: kpiAvui[0].total,
        stockBaix: stockBaix
      },
      ultimesVendes: db.table_to_json(ultimesVendes, {id:'number', data:'string', client:'string', total:'number'}),
      topProductes: db.table_to_json(topProductes, {name:'string', total_vendut:'number'}),
      common: getCommonData()
    };

    res.render('dashboard', data);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error dashboard');
  }
});

// ==================== PRODUCTES ====================
app.get('/productes', async (req, res) => {
  try {
    const page = parseInt(req.query.pagina || 0);
    const limit = 10;
    const offset = page * limit;
    const cerca = req.query.cerca || '';
    const where = cerca ? `WHERE name LIKE '%${cerca}%' OR category LIKE '%${cerca}%'` : '';
    
    const [products, count] = await Promise.all([
      db.query(`SELECT * FROM products ${where} ORDER BY id LIMIT ${limit} OFFSET ${offset}`),
      db.query(`SELECT COUNT(*) as total FROM products ${where}`)
    ]);
    
    res.render('productes/list', {
      products: db.table_to_json(products, {
        id: 'number', name: 'string', category: 'string',
        price: 'number', stock: 'number', active: 'boolean'
      }),
      pagina: page,
      totalPages: Math.ceil(count[0].total / limit),
      cerca,
      common: getCommonData()
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error productes');
  }
});

app.get('/producteAfegir', async (req, res) => {
  res.render('productes/form', { producte: {}, common: getCommonData() });
});

app.get('/producteEditar', async (req, res) => {
  try {
    const id = parseInt(req.query.id, 10);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).send('ID invàlid');
    
    const productes = await db.query(`SELECT * FROM products WHERE id = ${id} LIMIT 1`);
    if (!productes.length) return res.status(404).send('Producte no trobat');
    
    res.render('productes/form', {
      producte: db.table_to_json(productes, {
        id: 'number', name: 'string', category: 'string',
        price: 'number', stock: 'number', active: 'boolean'
      })[0],
      common: getCommonData()
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error editar');
  }
});

// ==================== CLIENTS ====================
app.get('/clients', async (req, res) => {
  try {
    const page = parseInt(req.query.pagina || 0);
    const limit = 10;
    const offset = page * limit;
    const cerca = req.query.cerca || '';
    const vip = req.query.vip === '1';
    let where = '';
    
    if (cerca) where += `WHERE name LIKE '%${cerca}%' OR email LIKE '%${cerca}%'`;
    if (vip) where += (where ? ' AND ' : 'WHERE ') + '(SELECT SUM(total) FROM sales WHERE customer_id=c.id) > 100';
    
    const [clients, count] = await Promise.all([
      db.query(`SELECT c.*, COALESCE(SUM(s.total), 0) as total_gastat, COUNT(s.id) as num_compres FROM customers c LEFT JOIN sales s ON c.id=s.customer_id ${where} GROUP BY c.id ORDER BY c.id LIMIT ${limit} OFFSET ${offset}`),
      db.query(`SELECT COUNT(DISTINCT c.id) as total FROM customers c ${where}`)
    ]);
    
    res.render('clients/list', {
      clients: db.table_to_json(clients, {id:'number', name:'string', email:'string', phone:'string', total_gastat:'number', num_compres:'number'}),
      pagina: page, totalPages: Math.ceil(count[0].total / limit), cerca, vip,
      common: getCommonData()
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error clients');
  }
});

app.get('/clientAfegir', async (req, res) => {
  res.render('clients/form', { client: {}, common: getCommonData() });
});

app.get('/clientEditar', async (req, res) => {
  try {
    const id = parseInt(req.query.id, 10);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).send('ID invàlid');
    
    const clients = await db.query(`SELECT * FROM customers WHERE id = ${id} LIMIT 1`);
    if (!clients.length) return res.status(404).send('Client no trobat');
    
    res.render('clients/form', {
      client: db.table_to_json(clients, {id:'number', name:'string', email:'string', phone:'string'})[0],
      common: getCommonData()
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error editar');
  }
});

app.get('/clientFitxa', async (req, res) => {
  try {
    const id = parseInt(req.query.id, 10);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).send('ID invàlid');
    
    const [client, vendes] = await Promise.all([
      db.query(`SELECT * FROM customers WHERE id = ${id} LIMIT 1`),
      db.query(`SELECT s.id, DATE_FORMAT(s.sale_date, '%d/%m/%Y') as sale_date, s.total FROM sales s WHERE s.customer_id = ${id} ORDER BY s.sale_date DESC LIMIT 10`)
    ]);
    
    if (!client.length) return res.status(404).send('Client no trobat');
    
    const totalGastat = await db.query(`SELECT COALESCE(SUM(total), 0) as total FROM sales WHERE customer_id = ${id}`);
    const ticketMitja = totalGastat[0].total / (await db.query(`SELECT COUNT(*) as total FROM sales WHERE customer_id = ${id}`))[0].total || 0;
    
    res.render('clients/fitxa', {
      client: db.table_to_json(client, {id:'number', name:'string', email:'string', phone:'string'})[0],
      vendes: db.table_to_json(vendes, {id:'number', sale_date:'string', total:'number'}),
      totalGastat: totalGastat[0].total,
      ticketMitja: ticketMitja.toFixed(2),
      common: getCommonData()
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error fitxa');
  }
});

// ==================== VENDES (similar a productes) ====================
app.get('/vendes', async (req, res) => {
  try {
    const page = parseInt(req.query.pagina || 0);
    const limit = 10;
    const offset = page * limit;
    const cerca = req.query.cerca || '';
    
    // Cercador flexible: busca per data o per nom de client
    const where = cerca 
      ? `WHERE s.sale_date LIKE '%${cerca}%' OR c.name LIKE '%${cerca}%'` 
      : '';
    
    const [vendes, count] = await Promise.all([
      db.query(`SELECT s.id, DATE_FORMAT(s.sale_date, '%d/%m/%Y') as sale_date, c.name as client, s.total 
                FROM sales s 
                JOIN customers c ON s.customer_id = c.id 
                ${where} 
                ORDER BY s.sale_date DESC LIMIT ${limit} OFFSET ${offset}`),
      db.query(`SELECT COUNT(*) as total FROM sales s JOIN customers c ON s.customer_id = c.id ${where}`)
    ]);
    
    res.render('vendes/list', {
      vendes: db.table_to_json(vendes, {id:'number', sale_date:'string', client:'string', total:'number'}),
      pagina: page, 
      totalPages: Math.ceil(count[0].total / limit), 
      cerca,
      common: getCommonData()
    });
  } catch (err) {
    console.error("🔥 Error al llistat de vendes:", err);
    res.status(500).send('Error vendes');
  }
});

// ==================== NOVA VENDA (FORMULARI) ====================
app.get('/vendaAfegir', async (req, res) => {
  try {
    // Necessitem els clients i els productes per omplir els desplegables del formulari
    const [clients, productes] = await Promise.all([
      db.query(`SELECT id, name FROM customers ORDER BY name`),
      db.query(`SELECT id, name, price, stock FROM products WHERE active = 1 AND stock > 0 ORDER BY name`)
    ]);
    
    res.render('vendes/form', {
      clients: db.table_to_json(clients, {id:'number', name:'string'}),
      productes: db.table_to_json(productes, {id:'number', name:'string', price:'number', stock:'number'})
    });
  } catch (err) {
    console.error("🔥 Error a GET /vendaAfegir:", err);
    res.status(500).send('Error carregant el formulari de venda');
  }
});

app.get('/vendaFitxa', async (req, res) => {
  try {
    const id = parseInt(req.query.id, 10);
    if (!id) return res.status(400).send('ID de venda no informat');

    // 1. Dades de la venda i el client
    const resHead = await db.query(`
      SELECT s.id, DATE_FORMAT(s.sale_date, '%d/%m/%Y %H:%i') as data_venda, 
             s.payment_method, s.total, c.name as client_name, c.email as client_email 
      FROM sales s 
      JOIN customers c ON s.customer_id = c.id 
      WHERE s.id = ${id}
    `);
    const venda = Array.isArray(resHead) ? resHead[0] : resHead;

    if (!venda) return res.status(404).send('Venda no trobada');

    // 2. Línies de la venda (Productes venuts)
    // IMPORTANT: Revisa si a la teva BD el camp es diu 'unit_price' o 'price'
    const linies = await db.query(`
      SELECT p.name as product_name, si.qty, si.unit_price, (si.qty * si.unit_price) as line_total 
      FROM sale_items si 
      JOIN products p ON si.product_id = p.id 
      WHERE si.sale_id = ${id}
    `);

    res.render('vendes/fitxa', {
      venda: db.table_to_json([venda], {id:'number', data_venda:'string', payment_method:'string', total:'number', client_name:'string', client_email:'string'})[0],
      linies: db.table_to_json(linies, {product_name:'string', qty:'number', unit_price:'number', line_total:'number'})
    });

  } catch (err) {
    console.error("🔥 Error a /vendaFitxa:", err);
    res.status(500).send('Error carregant el detall: ' + err.message);
  }
});

// Aquesta és la ruta que processarà l'enviament del formulari
app.post('/createVenda', async (req, res) => {
  try {
    const { customer_id, payment_method, product_id, qty } = req.body;

    // 1. Validació de seguretat: si no hi ha productes, no fem res
    if (!product_id) {
        return res.status(400).send("No has seleccionat cap producte.");
    }

    // Convertim a Array per si només n'hi ha un
    const prodIds = [].concat(product_id);
    const qtys = [].concat(qty);
    let totalVenda = 0;

    // 2. Calculem el total real consultant la BD
    for (let i = 0; i < prodIds.length; i++) {
        const pId = prodIds[i];
        const q = qtys[i];
        if (!pId || q <= 0) continue;

        const result = await db.query(`SELECT price FROM products WHERE id = ${pId}`);
        // El resultat de db.query sol ser un array d'objectes
        const p = Array.isArray(result) ? result[0] : result;
        
        if (p) {
            totalVenda += (p.price) * q;
        }
    }

    // 3. Inserim la capçalera a 'sales'
    // REVISA: Comprova que els camps customer_id, payment_method i total es diguin així!
    const insertSale = await db.query(`INSERT INTO sales (customer_id, sale_date, payment_method, total) VALUES (${customer_id}, NOW(), "${payment_method}", ${totalVenda})`);
    
    // Obtenim la ID de la venda acabada de crear
    const lastIdResult = await db.query(`SELECT LAST_INSERT_ID() as id`);
    const sale_id = lastIdResult[0].id;

    // 4. Creem les línies i actualitzem estoc
    for (let i = 0; i < prodIds.length; i++) {
        const pId = prodIds[i];
        const q = qtys[i];
        if (!pId || q <= 0) continue;

        const resultP = await db.query(`SELECT price FROM products WHERE id = ${pId}`);
        const p = Array.isArray(resultP) ? resultP[0] : resultP;
        const preuUnitari = p.price;

        // REVISA: Comprova que la taula 'sale_items' tingui aquests camps exactes
        await db.query(`INSERT INTO sale_items (sale_id, product_id, qty, unit_price, line_total) VALUES (${sale_id}, ${pId}, ${q}, ${preuUnitari}, ${q * preuUnitari})`);
        
        // Restem estoc
        await db.query(`UPDATE products SET stock = stock - ${q} WHERE id = ${pId}`);
    }

    res.redirect('/vendes');

  } catch (err) {
    // AQUESTA LÍNIA ÉS CLAU: Mira el terminal del Proxmox (on fas el npm start o pm2 logs)
    // Allà et dirà si el camp es diu 'product_id' o 'id_producte', etc.
    console.error("🔥 ERROR DETECTAT A LA VENDA:", err.message);
    res.status(500).send('Error processant la venda: ' + err.message);
  }
});

// ==================== CRUD GENÈRIC ====================

// Diccionari per traduir de la web a la base de dades
const mapTaules = {
  'productes': 'products',
  'clients': 'customers',
  'vendes': 'sales'
};

app.post('/create', async (req, res) => {
  try {
    const webTable = req.body.taula; // Exemple: 'clients'
    const sqlTable = mapTaules[webTable]; // Traduït: 'customers'
    
    // Esborrem 'taula' perquè no s'intenti inserir a MySQL
    delete req.body.taula; 

    // Adaptem el checkbox d'actiu per a productes
    if (req.body.active === 'on') req.body.active = 1;

    // Construïm la query SQL
    const fields = Object.keys(req.body).join(', ');
    const values = Object.values(req.body).map(v => `"${v}"`).join(', ');
    
    await db.query(`INSERT INTO ${sqlTable} (${fields}) VALUES (${values})`);
    
    // Tornem al llistat correcte
    res.redirect(`/${webTable}`); 
  } catch (err) {
    console.error("🔥 Error real de MySQL a /create:", err); 
    res.status(500).send('Error creació');
  }
});

app.post('/Update', async (req, res) => {
  try {
    const webTable = req.body.taula;
    const sqlTable = mapTaules[webTable];
    const id = parseInt(req.body.id, 10);
    
    delete req.body.taula; 
    delete req.body.id;
    
    // Adaptem el checkbox (si és producte i no l'envien, vol dir inactiu)
    if (req.body.active === 'on') req.body.active = 1;
    else if (webTable === 'productes') req.body.active = 0;

    const updates = Object.keys(req.body).map(k => `${k}="${req.body[k]}"`).join(', ');
    await db.query(`UPDATE ${sqlTable} SET ${updates} WHERE id = ${id}`);
    
    res.redirect(`/${webTable}`);
  } catch (err) {
    console.error("🔥 Error real de MySQL a /Update:", err);
    res.status(500).send('Error actualització');
  }
});

app.post('/Delete', async (req, res) => {
  try {
    const webTable = req.body.taula;
    const sqlTable = mapTaules[webTable];
    const id = parseInt(req.body.id, 10);
    
    await db.query(`DELETE FROM ${sqlTable} WHERE id = ${id}`);
    res.redirect(`/${webTable}`);
  } catch (err) {
    console.error("🔥 Error real de MySQL a /Delete:", err);
    res.status(500).send('Error esborrat');
  }
});



// Start server
const httpServer = app.listen(port, () => {
  console.log(`🚀 MiniERP: http://localhost:${port}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  await db.end();
  httpServer.close();
  process.exit(0);
});