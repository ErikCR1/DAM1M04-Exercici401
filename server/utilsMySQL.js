var mysql = require("mysql2");

class Obj {
  // Init pool
  init(parameters) {
    this.pool = mysql.createPool({
      connectionLimit: 10,
      host: parameters.host,
      port: parameters.port,
      user: parameters.user,
      password: parameters.password,
      database: parameters.database,
    });

    this.pool.on("connection", (connection) => {
      connection.query("SET SESSION group_concat_max_len = 1048576", () => {});
    });

    console.log("MySQL connected with destination: " + parameters.database);
  }

  // Tanca pool
  end() {
    return this.pool.end();
  }

  // Query amb callback
  callbackQuery(queryStr, callback) {
    this.pool.query(queryStr, (err, rst) => callback(err, rst));
  }

  // Query amb promesa
  query(queryStr) {
    return new Promise((resolve, reject) => {
      return this.callbackQuery(queryStr, (err, rst) => {
        if (err) {
          return reject(err);
        } else {
          return resolve(rst);
        }
      });
    });
  }

  // Converteix files
  table_to_json(rows, schema = {}) {
    const cast = (v, forcedType) => {
      if (v === null || v === undefined) return null;

      if (forcedType === "string") return String(v);

      if (forcedType === "number") {
        if (typeof v === "number") return v;
        if (typeof v === "string" && v.trim() === "") return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      }

      if (forcedType === "boolean") {
        if (typeof v === "boolean") return v;
        if (typeof v === "number") return v !== 0;
        const s = String(v).toLowerCase();
        if (s === "true") return true;
        if (s === "false") return false;
        const n = Number(s);
        return Number.isNaN(n) ? Boolean(v) : n !== 0;
      }

      if (forcedType === "date") {
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        return String(v);
      }

      if (forcedType === "datetime") {
        if (v instanceof Date) return v.toISOString();
        return String(v);
      }

      if (forcedType === "base64") {
        if (Buffer.isBuffer(v)) return v.toString("base64");
        return String(v);
      }

      if (Buffer.isBuffer(v)) return v.toString("base64");
      if (v instanceof Date) return v.toISOString();

      if (typeof v === "bigint") {
        const n = Number(v);
        return Number.isSafeInteger(n) ? n : v.toString();
      }

      if (typeof v === "number" || typeof v === "boolean") return v;

      return v;
    };

    return rows.map((row) => {
      const obj = {};
      for (const [col, val] of Object.entries(row))
        obj[col] = cast(val, schema[col]);
      return obj;
    });
  }
}

module.exports = Obj;
