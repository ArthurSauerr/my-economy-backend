const express = require('express');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const app = express();
const port = 3005;
dotenv.config();

//PARA RODAR O SERVIDOR EXECUTE ESSE COMANDO: node src/index.js

//Comandos utilizados para gerar o TOKEN_SECRET -> .env
//const crypto = require('crypto');
//console.log(crypto.randomBytes(64).toString('hex'));

const { Pool } = require('pg');
const pool = new Pool({
    user: 'arthur',
    host: 'localhost',
    database: 'myeconomydb',
    password: 'root',
    port: 5432
});

app.use(express.json());

if (!process.env.TOKEN_SECRET) {
    console.error('Falta a chave secreta para o TOKEN JWT!');
    process.exit(1);
}

function generateAccessToken(email) {
    const payload = { email };
    return jwt.sign(payload, process.env.TOKEN_SECRET, { expiresIn: '21600s' });
}

async function validateToken(req, res, next) {
    const { authorization } = req.headers;
    if (!authorization) {
        return res.sendStatus(403);
    }

    const token = authorization.replace('Bearer ', '');
    try {
        const decoded = jwt.verify(token, process.env.TOKEN_SECRET);
        const userId = await getUserIdFromToken(decoded.email);
        if (userId) {
            req.user = { email: decoded.email, id: userId };
            next();
        } else {
            res.sendStatus(403);
        }
    } catch (error) {
        res.sendStatus(403);
    }
}

async function getUserIdFromToken(email) {
    try {
        const client = await pool.connect();
        const result = await client.query('SELECT id FROM users WHERE email = $1', [email]);
        client.release();
        if (result.rows.length > 0) {
            return result.rows[0].id;
        }
        return null;
    } catch (error) {
        console.error('Erro ao extrair id do usuário', error);
        return null;
    }
}

const today = new Date();
const month = today.getMonth() + 1;
console.log('Mês atual:', month);

async function checkMonth(id) {
    //Extrai o valor do mes contido na coluna reference_month para comparar com o mes atual
    try {
        const client = await pool.connect();
        const expenseMonthResult = await client.query(
            'SELECT EXTRACT (MONTH FROM reference_month) AS month FROM expenses WHERE id = $1',
            [id]
        );
        client.release();
        if (expenseMonthResult.rows.length > 0) {
            const expenseMonth = expenseMonthResult.rows[0].month;
            return expenseMonth < month;
        }
        return false;
    } catch (error) {
        console.error('Erro na funçao checkMonth', error);
        return false;
    }
}

async function checkMonthLimit(id) {
    try {
        const client = await pool.connect();
        const limitMonthResult = await client.query(
            'SELECT EXTRACT (MONTH FROM reference_month) AS month FROM user_limit WHERE id = $1',
            [id]
        );
        client.release();
        if (limitMonthResult.rows.length > 0) {
            const limitMonth = limitMonthResult.rows[0].month;
            return limitMonth < month;
        }
        return false;
    } catch (error) {
        console.error('Erro ao checar mês do Limite', error);
        return false;
    }
}

// ------ENDPOINTS USUARIO------

app.post('/signup', async (req, res) => {
    const { name, email, password, birthdate } = req.body;
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    try {
        const client = await pool.connect();
        const userExists = await client.query('SELECT * FROM users WHERE email = $1', [email]);
        if (userExists.rows.length > 0) {
            client.release();
            return res.status(400).send('Usuário já existe!');
        } else {
            const newUser = await client.query(
                'INSERT INTO users (name, email, password, birthdate) VALUES ($1, $2, $3, $4) RETURNING *',
                [name, email, hashedPassword, birthdate]
            );
            client.release();
            res.status(201).json({ message: 'Usuário cadastrado com sucesso!', user: newUser.rows[0] });
        }
    } catch (error) {
        console.error('Erro ao cadastrar usuário: ', error);
        res.status(500).json({ error: 'Erro ao cadastrar usuário!' });
    }
});

app.post('/signin', async (req, res) => {
    const { email, password } = req.body;

    try {
        const client = await pool.connect();
        const userExists = await client.query('SELECT * FROM users WHERE email = $1', [email]);
        if (userExists.rows.length > 0) {
            const user = userExists.rows[0];
            const isMatch = await bcrypt.compare(password, user.password);
            if (isMatch) {
                const token = generateAccessToken(email);
                client.release();
                return res.status(200).json({ token });
            } else {
                client.release();
                return res.status(400).send('Senha incorreta!')
            }
        } else {
            client.release();
            return res.status(400).send('Usuário não encontrado!')
        }
    } catch (error) {
        console.error('Erro ao realizar login: ', error);
        res.status(500).send('Erro ao realizar login!');
    }
});

app.get('/user', validateToken, async (req, res) => {
    const userId = req.user.id;

    try {
        const client = await pool.connect();
        const read = await client.query(
            'SELECT * FROM users WHERE id = $1',
            [userId]
        );
        client.release();
        res.status(200).json({ users: read.rows });
    } catch (error) {
        console.error('Erro ao listar usuários', error);
        res.status(500).send('Erro ao listar usuários!');
    }
});

// ------ENDPOINTS DESPESAS------

app.post('/expense/create', validateToken, async (req, res) => {
    const { description, amount, reference_month } = req.body;
    const userId = req.user.id;

    //Pega o indice 3 e 4 da data para comparar com o mes atual
    const index1 = reference_month.charAt(3);
    const index2 = reference_month.charAt(4);
    const expenseMonth = index1 + index2;

    if (expenseMonth < month) {
        res.status(400).send('Não é possível inserir um despesa em um mês anterior ao atual!');
    } else {
        try {
            const client = await pool.connect();
            await client.query('SET datestyle = "DMY"');
            const newExpense = await client.query(
                'INSERT INTO expenses (description, amount, reference_month, user_id) VALUES ($1, $2, $3, $4) RETURNING *',
                [description, amount, reference_month, userId]
            );
            client.release();
            res.status(200).json({ message: 'Despesa cadastrada com sucesso!', expense: newExpense.rows[0] })
        } catch (error) {
            console.error('Erro ao cadastrar despesa', error);
            res.status(500).send('Erro ao cadastrar despesa!');
        }
    }
});

app.get('/expense', validateToken, async (req, res) => {
    const userId = req.user.id;

    try {
        const client = await pool.connect();
        const read = await client.query(
            'SELECT * FROM expenses WHERE user_id = $1', 
            [userId]
        );
        client.release();
        res.status(200).json({ expenses: read.rows })
    } catch (error) {
        console.error('Erro ao listar despesas', error);
        res.status(500).send('Erro ao listar despesas do usuário!')
    }
});

app.put('/expense/update', validateToken, async (req, res) => {
    const { id, description, amount } = req.body;
    const isOlderMonth = await checkMonth(id);

    if (isOlderMonth) {
        res.status(400).send('Não é possível atualizar uma despesa antiga!');
    } else {
        try {
            const client = await pool.connect();
            const expenseExists = await client.query(
                'SELECT * FROM expenses WHERE id = $1',
                [id]
            );
            if (expenseExists.rows.length > 0) {
                if (description == null || amount == null) {
                    client.release();
                    res.status(400).send('Preencha todos os campos!');
                } else {
                    await client.query(
                        'UPDATE expenses SET description = $2, amount = $3 WHERE id = $1',
                        [id, description, amount]
                    );
                    client.release();
                    res.status(200).send('Despesa atualizada com sucesso!');
                }
            } else {
                client.release();
                res.status(400).send('Essa despesa não existe!');
            }
        } catch (error) {
            console.error('Erro ao atualizar despesa', error);
            res.status(500).send('Erro ao atualizar despesa!');
        }
    }
});

app.delete('/expense/delete', validateToken, async (req, res) => {
    const { id } = req.body;
    const isOlderMonth = await checkMonth(id);

    if (isOlderMonth) {
        res.status(400).send('Não é possível excluir uma despesa antiga!')
    } else {
        try {
            const client = await pool.connect();
            const expenseExists = await client.query(
                'SELECT * FROM expenses WHERE id = $1',
                [id]
            );
            if (expenseExists.rows.length > 0) {
                await client.query(
                    'DELETE FROM expenses WHERE id = $1',
                    [id]
                );
                client.release();
                res.status(200).send('Despesa excluída com sucesso!');
            } else {
                client.release();
                res.status(400).send('Essa despesa não existe!');
            }
        } catch (error) {
            console.error('Erro ao excluir despesa', error);
            res.status(500).send('Erro ao excluir despesa!');
        }
    }
});

// ------ENDPOINTS LIMITE------

app.post('/limit/create', validateToken, async(req, res) => {
    const { reference_month, limit_amount } = req.body;
    const userId = req.user.id;

    const index1 = reference_month.charAt(3);
    const index2 = reference_month.charAt(4);
    const limitMonth = index1 + index2;

    if (limitMonth < month) {
        res.status(400).send('Não é possível inserir um limite em um mês anterior ao atual!')
    } else {
        try {
            const client = await pool.connect();
            await client.query('SET datestyle = "DMY"');
            const limitExists = await client.query(
                'SELECT * FROM user_limit WHERE user_id = $1 AND EXTRACT(MONTH FROM reference_month) = $2',
                [userId, limitMonth]
            );
            if (limitExists.rows.length > 0) {
                client.release();
                res.status(400).send('Já existe um limite inserido nesse mês')
            } else {
                await client.query('SET datestyle = "DMY"');
                const newLimit = await client.query(
                    'INSERT INTO user_limit (user_id, reference_month, limit_amount) VALUES ($1, $2, $3) RETURNING *',
                    [userId, reference_month, limit_amount]
                );
                client.release();
                res.status(200).json({ message: 'Limite cadastrado com sucesso!', limit: newLimit.rows[0] })
            }
        } catch (error) {
            res.status(500).send('Erro ao inserir um limite!');
            console.error('Erro ao inserir limite', error);
        }
    }
});

app.get('/limit', validateToken, async (req, res) => {
    const userId = req.user.id;

    try { 
        const client = await pool.connect();
        const read = await client.query(
            'SELECT * FROM user_limit WHERE user_id = $1',
            [userId]
        );
        client.release();
        res.status(200).json({ limits: read.rows })
    } catch (error) {
        res.status(500).send('Erro ao buscar limites');
        console.error('Erro ao buscar limites', error);
    }
});

app.get('/limit/today', validateToken, async (req, res) => {
    const userId = req.user.id;

    try { 
        const client = await pool.connect();
        const read = await client.query(
            'SELECT * FROM user_limit WHERE user_id = $1 AND EXTRACT(MONTH FROM reference_month) = $2',
            [userId, month]
        );
        client.release();
        res.status(200).json({ limits: read.rows })
    } catch (error) {
        res.status(500).send('Erro ao buscar limites');
        console.error('Erro ao buscar limites', error);
    }
});

app.put('/limit/update', validateToken, async (req, res) => {
    const { id, limit_amount } = req.body;
    const isOlderMonth = await checkMonthLimit(id);

    if (isOlderMonth) {
        res.status(400).send('Não é possível atualizar um limite antigo!');
    } else {
        try {
            const client = await pool.connect();
            const limitExists = await client.query(
                'SELECT * FROM user_limit WHERE id = $1',
                [id]
            );
            if (limitExists.rows.length > 0) {
                if (limit_amount == null) {
                    res.status(400).send('Preencha o campo de limite para pode atualizar!');
                } else {
                    await client.query(
                        'UPDATE user_limit SET limit_amount = $1 WHERE id = $2',
                        [limit_amount, id]
                    );
                    client.release();
                    res.status(200).send('Limite atualizado com sucesso!');
                }
            } else {
                client.release();
                res.status(400).send('Esse limite não existe!');
            }
        } catch (error) {
            res.status(500).send('Erro ao atualizar limite');
            console.error('Erro ao atualizar limite', error);
        }
    }
});

app.delete("/limit/delete", validateToken, async (req, res) => {
  const { id } = req.body;
  const isOlderMonth = await checkMonthLimit(id);

  if (isOlderMonth) {
    res.status(400).send("Não é possível excluir um limite antigo!");
  } else {
    try {
      const client = await pool.connect();
      const limitExists = await client.query(
        "SELECT * FROM user_limit WHERE id = $1",
        [id]
      );
      if (limitExists.rows.length > 0) {
        await client.query("DELETE FROM user_limit WHERE id = $1", [id]);
        client.release();
        res.status(200).send("Limite excluído com sucesso!");
      } else {
        client.release();
        res.status(400).send("Esse limite não existe!");
      }
    } catch (error) {
      console.error("Erro ao excluir limite", error);
      res.status(500).send("Erro ao excluir limite!");
    }
  }
});

app.listen(port, () => {
    console.log(`Servidor inicializado em: http://localhost:${port}`);
});
