const mysql = require('mysql2');
const connection = mysql.createConnection({ /* .env */ });

exports.create = (req, res) => {
  const taula = req.body.taula;
  delete req.body.taula;
  const fields = Object.keys(req.body).join(', ');
  const values = Object.values(req.body).map(v => `'${v}'`).join(', ');
  connection.query(`INSERT INTO ${taula} (${fields}) VALUES (${values})`, (err) => {
    if (err) throw err;
    res.redirect(`/${taula.slice(0,-1)}`); // ex: /productes
  });
};

exports.update = (req, res) => { /* UPDATE similar amb WHERE id */ };
exports.delete = (req, res) => { /* DELETE WHERE id */ };