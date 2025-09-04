const jwt = require("jsonwebtoken");

function authenticateJWT(req, res, next) {
  const token = req.cookies?.token; // ✅ safer access

  if (!token) {
    return res.status(401).redirect("/login");
  }

  jwt.verify(token, process.env.JWT_SECRET || "supersecretkey", (err, decoded) => {
    if (err) return res.status(403).redirect("/login");
    req.user = decoded;
    next();
  });
}

module.exports = authenticateJWT;
