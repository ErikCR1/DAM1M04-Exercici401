const mysql = require('mysql2');
const connection = mysql.createConnection({ /* .env */ });

exports.list = (req, res) => {
  const page = parseInt(req.query.pagina || 0);
  const limit = 10;
  const offset = page * limit;
  const cerca = req.query.cerca || '';
  const where = cerca ? `WHERE name LIKE '%${cerca}%' OR category LIKE '%${cerca}%'` : '';
  
  connection.query(`SELECT * FROM products ${where} LIMIT ${limit} OFFSET ${offset}`, (err, products) => {
    if (err) throw err;
    connection.query(`SELECT COUNT(*) as total FROM products ${where}`, (err, count) => {
      res.render('productes/list', {
        products,
        pagina: page,
        totalPages: Math.ceil(count[0].total / limit),
        cerca
      });
    });
  });
}; 