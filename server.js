require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { MercadoPagoConfig, Payment } = require('mercadopago');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware para JSON e servir arquivos estáticos da pasta public
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Garante que a pasta de uploads de imagens existe
const uploadsDir = path.join(__dirname, 'public', 'images', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configuração do Multer para uploads de imagens de produtos
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp|gif/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error('Apenas arquivos de imagem são permitidos! (jpeg, jpg, png, webp, gif)'));
  },
  limits: { fileSize: 5 * 1024 * 1024 } // limite de 5MB por arquivo
});

// Mock de dados para fallback/sincronização caso o banco MySQL não esteja ativo
let MOCK_CATEGORIAS = ['Roupas', 'Acessórios'];

let MOCK_PRODUTOS = [
  {
    id: 1,
    nome: 'Poncho Premium de Alpaca',
    descricao: 'Poncho tradicional peruano confeccionado em pura lã de alpaca, oferecendo conforto térmico incomparável, leveza e um design contemporâneo nas cores vermelho e nude.',
    preco: 389.90,
    imagem_url: '/images/alpaca_poncho.svg',
    categoria: 'Roupas',
    cores: 'Padrão, Vermelho, Nude'
  },
  {
    id: 2,
    nome: 'Camiseta Algodão Pima Peruano',
    descricao: 'Camiseta confeccionada em algodão Pima 100% peruano, reconhecido mundialmente pela maciez extrema e alta durabilidade. Detalhe minimalista no bolso.',
    preco: 149.90,
    imagem_url: '/images/peruvian_tshirt.svg',
    categoria: 'Roupas',
    cores: 'Sand, Vermelho, Preto'
  },
  {
    id: 3,
    nome: 'Case de Couro Andes para iPhone',
    descricao: 'Capa premium protetora feita à mão com couro legítimo nobre e costura contrastante vermelha. Compatível com MagSafe.',
    preco: 189.90,
    imagem_url: '/images/phone_case.svg',
    categoria: 'Acessórios',
    cores: 'Tan, Preto, Vermelho'
  },
  {
    id: 4,
    nome: 'Headphones Sem Fio Andes Pro',
    descricao: 'Headphones sem fio de alta fidelidade com cancelamento de ruído ativo. Acabamento sofisticado na cor nude com detalhes em vermelho fosco e almofadas de couro.',
    preco: 599.90,
    imagem_url: '/images/wireless_headphones.svg',
    categoria: 'Acessórios',
    cores: 'Nude, Vermelho, Preto'
  }
];

let MOCK_PRODUTO_IMAGENS = {
  1: ['/images/alpaca_poncho.svg', '/images/peruvian_tshirt.svg', '/images/phone_case.svg'],
  2: ['/images/peruvian_tshirt.svg', '/images/alpaca_poncho.svg'],
  3: ['/images/phone_case.svg', '/images/wireless_headphones.svg'],
  4: ['/images/wireless_headphones.svg', '/images/phone_case.svg', '/images/alpaca_poncho.svg']
};

// Mock de dados para clientes e pedidos completos
let MOCK_CLIENTES = [];
let MOCK_PEDIDOS_FULL = [];
let activeSessions = {}; // token -> clienteData

// Configuração da conexão com o banco de dados MySQL
let pool = null;

async function conectarBanco() {
  try {
    pool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'loja_peru',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });
    
    const connection = await pool.getConnection();
    console.log('✅ Conexão com o banco de dados MySQL realizada com sucesso.');
    connection.release();
  } catch (error) {
    console.warn('⚠️ Não foi possível conectar ao banco de dados MySQL.');
    console.warn('Mensagem do erro:', error.message);
    console.warn('💡 O servidor continuará executando usando dados estáticos (MOCKS) em memória como alternativa.');
    pool = null;
  }
}

conectarBanco();

// Configura o SDK do Mercado Pago
const mpClient = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN || 'TEST-8765432109876543-060212-xxxxxx-123456789'
});

// ==========================================
// Funções auxiliares de autenticação
// ==========================================

// Gerar hash de senha com salt (SHA-256 + salt aleatório)
function hashPassword(password, salt) {
  if (!salt) salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHash('sha256').update(password + salt).digest('hex');
  return { hash, salt };
}

// Gerar token de sessão aleatório
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Validação de CPF com algoritmo oficial brasileiro
function validarCPF(cpf) {
  cpf = cpf.replace(/\D/g, '');
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false; // todos dígitos iguais
  
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += parseInt(cpf.charAt(i)) * (10 - i);
  let resto = (soma * 10) % 11;
  if (resto === 10 || resto === 11) resto = 0;
  if (resto !== parseInt(cpf.charAt(9))) return false;
  
  soma = 0;
  for (let i = 0; i < 10; i++) soma += parseInt(cpf.charAt(i)) * (11 - i);
  resto = (soma * 10) % 11;
  if (resto === 10 || resto === 11) resto = 0;
  if (resto !== parseInt(cpf.charAt(10))) return false;
  
  return true;
}

// Middleware para extrair cliente logado do token de sessão
function getClienteFromToken(req) {
  const token = req.headers['authorization'];
  if (token && activeSessions[token]) {
    return activeSessions[token];
  }
  return null;
}

// ==========================================
// Rotas de Autenticação de Clientes
// ==========================================

// POST /auth/cadastro - Cadastrar novo cliente
app.post('/auth/cadastro', async (req, res) => {
  try {
    const { nome_completo, email, cpf, telefone, senha } = req.body;

    // Validação dos campos obrigatórios
    if (!nome_completo || !email || !cpf || !senha) {
      return res.status(400).json({ error: 'Campos obrigatórios ausentes (nome_completo, email, cpf, senha)' });
    }

    // Validação do CPF com algoritmo oficial
    if (!validarCPF(cpf)) {
      return res.status(400).json({ error: 'CPF inválido. Verifique os dígitos informados.' });
    }

    // Verificar se e-mail ou CPF já existem no banco
    if (pool) {
      try {
        const [existentes] = await pool.query(
          'SELECT id FROM clientes WHERE email = ? OR cpf = ?',
          [email, cpf]
        );
        if (existentes.length > 0) {
          return res.status(409).json({ error: 'E-mail ou CPF já cadastrado.' });
        }
      } catch (dbErr) {
        console.error('Erro ao verificar duplicidade no banco:', dbErr.message);
      }
    }

    // Verificar duplicidade também nos mocks
    const duplicadoMock = MOCK_CLIENTES.find(c => c.email === email || c.cpf === cpf);
    if (duplicadoMock) {
      return res.status(409).json({ error: 'E-mail ou CPF já cadastrado.' });
    }

    // Gerar hash da senha
    const { hash, salt } = hashPassword(senha);

    let insertedId = null;

    // Inserir no banco se disponível
    if (pool) {
      try {
        const [result] = await pool.query(
          'INSERT INTO clientes (nome_completo, email, cpf, telefone, senha_hash, senha_salt) VALUES (?, ?, ?, ?, ?, ?)',
          [nome_completo, email, cpf, telefone || null, hash, salt]
        );
        insertedId = result.insertId;
      } catch (dbErr) {
        console.error('Erro ao inserir cliente no banco:', dbErr.message);
      }
    }

    // Sempre adicionar ao mock para fallback
    if (!insertedId) {
      insertedId = MOCK_CLIENTES.length > 0
        ? Math.max(...MOCK_CLIENTES.map(c => c.id)) + 1
        : 1;
    }

    const novoCliente = {
      id: insertedId,
      nome_completo,
      email,
      cpf,
      telefone: telefone || null,
      senha_hash: hash,
      senha_salt: salt
    };

    MOCK_CLIENTES.push(novoCliente);

    console.log('✅ Novo cliente cadastrado:', nome_completo, '| Email:', email);

    return res.status(201).json({
      success: 'Cliente cadastrado com sucesso!',
      cliente: {
        id: novoCliente.id,
        nome_completo: novoCliente.nome_completo,
        email: novoCliente.email,
        cpf: novoCliente.cpf,
        telefone: novoCliente.telefone
      }
    });

  } catch (error) {
    console.error('Erro ao cadastrar cliente:', error);
    return res.status(500).json({ error: 'Erro interno ao cadastrar cliente', details: error.message });
  }
});

// POST /auth/login - Login do cliente
app.post('/auth/login', async (req, res) => {
  try {
    const { email, senha } = req.body;

    if (!email || !senha) {
      return res.status(400).json({ error: 'E-mail e senha são obrigatórios.' });
    }

    let clienteEncontrado = null;

    // Buscar no banco primeiro
    if (pool) {
      try {
        const [rows] = await pool.query('SELECT * FROM clientes WHERE email = ?', [email]);
        if (rows.length > 0) {
          clienteEncontrado = rows[0];
        }
      } catch (dbErr) {
        console.error('Erro ao buscar cliente no banco:', dbErr.message);
      }
    }

    // Fallback para mocks se não encontrado no banco
    if (!clienteEncontrado) {
      clienteEncontrado = MOCK_CLIENTES.find(c => c.email === email);
    }

    if (!clienteEncontrado) {
      return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    }

    // Verificar senha com o salt armazenado
    const { hash } = hashPassword(senha, clienteEncontrado.senha_salt);
    if (hash !== clienteEncontrado.senha_hash) {
      return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    }

    // Gerar token e armazenar sessão
    const token = generateToken();
    activeSessions[token] = {
      id: clienteEncontrado.id,
      nome_completo: clienteEncontrado.nome_completo,
      email: clienteEncontrado.email,
      cpf: clienteEncontrado.cpf,
      telefone: clienteEncontrado.telefone
    };

    console.log('🔑 Login realizado com sucesso para:', email);

    return res.json({
      success: 'Login realizado com sucesso!',
      token,
      cliente: {
        id: clienteEncontrado.id,
        nome_completo: clienteEncontrado.nome_completo,
        email: clienteEncontrado.email,
        cpf: clienteEncontrado.cpf,
        telefone: clienteEncontrado.telefone
      }
    });

  } catch (error) {
    console.error('Erro ao processar login:', error);
    return res.status(500).json({ error: 'Erro interno ao processar login', details: error.message });
  }
});

// GET /auth/me - Retorna dados do cliente logado via token
app.get('/auth/me', (req, res) => {
  const cliente = getClienteFromToken(req);
  if (!cliente) {
    return res.status(401).json({ error: 'Não autenticado. Token inválido ou ausente.' });
  }
  return res.json({ success: true, cliente });
});

// POST /auth/logout - Encerrar sessão do cliente
app.post('/auth/logout', (req, res) => {
  const token = req.headers['authorization'];
  if (token && activeSessions[token]) {
    console.log('🔒 Logout realizado para:', activeSessions[token].email);
    delete activeSessions[token];
  }
  return res.json({ success: 'Logout realizado com sucesso.' });
});

// ==========================================
// Rotas de Pedidos (Admin)
// ==========================================

// GET /pedidos - Lista todos os pedidos (painel admin)
app.get('/pedidos', async (req, res) => {
  try {
    if (pool) {
      try {
        const [rows] = await pool.query(
          'SELECT pedidos.*, produtos.nome as produto_nome FROM pedidos LEFT JOIN produtos ON pedidos.produto_id = produtos.id ORDER BY pedidos.id DESC'
        );
        if (rows.length > 0) {
          return res.json(rows);
        }
      } catch (dbErr) {
        console.error('Erro ao buscar pedidos no banco:', dbErr.message);
      }
    }
    // Fallback para mocks
    return res.json(MOCK_PEDIDOS_FULL);
  } catch (error) {
    console.error('Erro ao listar pedidos:', error);
    return res.json(MOCK_PEDIDOS_FULL);
  }
});

// PUT /pedidos/:id/status - Atualiza o status de um pedido (Admin)
app.put('/pedidos/:id/status', async (req, res) => {
  try {
    const pedidoId = parseInt(req.params.id);
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'Status é obrigatório.' });
    }

    let updated = false;

    // Atualizar no banco
    if (pool) {
      try {
        const [result] = await pool.query('UPDATE pedidos SET status = ? WHERE id = ?', [status, pedidoId]);
        updated = result.affectedRows > 0;
      } catch (dbErr) {
        console.error('Erro ao atualizar status do pedido no banco:', dbErr.message);
      }
    }

    // Atualizar nos mocks
    const mockPedido = MOCK_PEDIDOS_FULL.find(p => p.id === pedidoId);
    if (mockPedido) {
      mockPedido.status = status;
      updated = true;
    }

    if (updated) {
      console.log(`📦 Status do pedido #${pedidoId} alterado para: ${status}`);
      return res.json({ success: true, message: `Status do pedido #${pedidoId} alterado para ${status}.`, status });
    }

    return res.status(404).json({ error: 'Pedido não encontrado.' });
  } catch (error) {
    console.error('Erro ao atualizar status do pedido:', error);
    return res.status(500).json({ error: 'Erro interno ao atualizar status do pedido.', details: error.message });
  }
});

// GET /auth/me/pedidos - Lista os pedidos do cliente autenticado
app.get('/auth/me/pedidos', async (req, res) => {
  try {
    const cliente = getClienteFromToken(req);
    if (!cliente) {
      return res.status(401).json({ error: 'Não autenticado.' });
    }

    if (pool) {
      try {
        const [rows] = await pool.query(
          'SELECT pedidos.*, produtos.nome as produto_nome FROM pedidos LEFT JOIN produtos ON pedidos.produto_id = produtos.id WHERE pedidos.cliente_id = ? ORDER BY pedidos.id DESC',
          [cliente.id]
        );
        return res.json(rows);
      } catch (dbErr) {
        console.error('Erro ao buscar pedidos do cliente no banco:', dbErr.message);
      }
    }

    // Fallback para mocks
    const filteredMocks = MOCK_PEDIDOS_FULL.filter(
      p => p.cliente_id === cliente.id || (cliente.email && p.cliente_email === cliente.email)
    );
    return res.json(filteredMocks);
  } catch (error) {
    console.error('Erro ao buscar pedidos do cliente:', error);
    return res.status(500).json({ error: 'Erro interno ao obter pedidos do cliente.', details: error.message });
  }
});

// ==========================================
// Rotas de Categorias e Produtos (existentes)
// ==========================================

// 1. Rota GET /categorias - Lista as categorias dinâmicas
app.get('/categorias', async (req, res) => {
  try {
    if (pool) {
      const [rows] = await pool.query('SELECT * FROM categorias');
      if (rows.length > 0) {
        return res.json(rows.map(r => r.nome));
      }
    }
    return res.json(MOCK_CATEGORIAS);
  } catch (error) {
    console.error('Erro ao buscar categorias:', error);
    return res.json(MOCK_CATEGORIAS);
  }
});

// 2. Rota POST /categorias - Adiciona nova categoria (Admin)
app.post('/categorias', async (req, res) => {
  try {
    const { nome } = req.body;
    if (!nome) {
      return res.status(400).json({ error: 'Nome da categoria obrigatório' });
    }
    
    if (pool) {
      await pool.query('INSERT IGNORE INTO categorias (nome) VALUES (?)', [nome]);
    }
    
    if (!MOCK_CATEGORIAS.includes(nome)) {
      MOCK_CATEGORIAS.push(nome);
    }
    
    console.log('⚙️ Nova categoria criada:', nome);
    return res.status(201).json({ success: 'Categoria criada com sucesso!', nome });
  } catch (error) {
    console.error('Erro ao salvar categoria:', error);
    return res.status(500).json({ error: 'Erro ao salvar categoria', details: error.message });
  }
});

// 3. Rota GET /produtos - Busca os produtos no banco ou retorna os mocks
app.get('/produtos', async (req, res) => {
  try {
    if (pool) {
      const [rows] = await pool.query('SELECT * FROM produtos');
      if (rows.length > 0) {
        return res.json(rows);
      }
    }
    return res.json(MOCK_PRODUTOS);
  } catch (error) {
    console.error('Erro ao buscar produtos:', error);
    return res.json(MOCK_PRODUTOS);
  }
});

// 4. Rota GET /produtos/:id - Detalhes do produto + Galeria de fotos adicionais
app.get('/produtos/:id', async (req, res) => {
  const produtoId = parseInt(req.params.id);
  
  try {
    if (pool) {
      const [produtoRows] = await pool.query('SELECT * FROM produtos WHERE id = ?', [produtoId]);
      if (produtoRows.length > 0) {
        const produto = produtoRows[0];
        const [imgRows] = await pool.query('SELECT imagem_url FROM produto_imagens WHERE produto_id = ?', [produtoId]);
        const imagens = imgRows.length > 0 
          ? imgRows.map(r => r.imagem_url)
          : [produto.imagem_url];
          
        return res.json({
          ...produto,
          imagens: imagens
        });
      }
    }
    
    // Fallback Mock
    const mockProd = MOCK_PRODUTOS.find(p => p.id === produtoId);
    if (mockProd) {
      const imagens = MOCK_PRODUTO_IMAGENS[produtoId] || [mockProd.imagem_url];
      return res.json({
        ...mockProd,
        imagens: imagens
      });
    }
    
    return res.status(404).json({ error: 'Produto não encontrado' });
  } catch (error) {
    console.error(`Erro ao buscar produto ${produtoId}:`, error);
    return res.status(500).json({ error: 'Erro interno do servidor', details: error.message });
  }
});

// 5. Rota POST /produtos - Adicionar novo produto com imagens e cores (Painel Admin)
app.post('/produtos', upload.fields([
  { name: 'imagem_principal', maxCount: 1 },
  { name: 'imagens_adicionais', maxCount: 5 }
]), async (req, res) => {
  try {
    const { nome, descricao, preco, categoria, cores } = req.body;
    
    if (!nome || !descricao || !preco || !categoria) {
      return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
    }

    const coresConfig = cores || 'Padrão';

    let mainImageUrl = '/images/alpaca_poncho.svg'; 
    if (req.files && req.files['imagem_principal'] && req.files['imagem_principal'][0]) {
      mainImageUrl = `/images/uploads/${req.files['imagem_principal'][0].filename}`;
    }

    let additionalImagesUrls = [];
    if (req.files && req.files['imagens_adicionais']) {
      additionalImagesUrls = req.files['imagens_adicionais'].map(file => `/images/uploads/${file.filename}`);
    }

    if (!additionalImagesUrls.includes(mainImageUrl)) {
      additionalImagesUrls.unshift(mainImageUrl);
    }

    let insertedId = null;

    if (pool) {
      const [result] = await pool.query(
        'INSERT INTO produtos (nome, descricao, preco, imagem_url, categoria, cores) VALUES (?, ?, ?, ?, ?, ?)',
        [nome, descricao, parseFloat(preco), mainImageUrl, categoria, coresConfig]
      );
      insertedId = result.insertId;

      for (const imgUrl of additionalImagesUrls) {
        await pool.query(
          'INSERT INTO produto_imagens (produto_id, imagem_url) VALUES (?, ?)',
          [insertedId, imgUrl]
        );
      }
    } else {
      insertedId = MOCK_PRODUTOS.length > 0 
        ? Math.max(...MOCK_PRODUTOS.map(p => p.id)) + 1 
        : 1;
    }

    const novoProdutoMock = {
      id: insertedId,
      nome: nome,
      descricao: descricao,
      preco: parseFloat(preco),
      imagem_url: mainImageUrl,
      categoria: categoria,
      cores: coresConfig
    };
    
    MOCK_PRODUTOS.push(novoProdutoMock);
    MOCK_PRODUTO_IMAGENS[insertedId] = additionalImagesUrls;

    console.log('✅ Novo produto cadastrado:', novoProdutoMock);
    return res.status(201).json({ 
      success: 'Produto cadastrado com sucesso!', 
      produto: novoProdutoMock 
    });

  } catch (error) {
    console.error('Erro ao cadastrar produto:', error);
    return res.status(500).json({ error: 'Erro ao cadastrar produto', details: error.message });
  }
});

// 6. Rota DELETE /produtos/:id - Excluir produto (Painel Admin)
app.delete('/produtos/:id', async (req, res) => {
  const produtoId = parseInt(req.params.id);
  
  try {
    let deletedFromDb = false;
    
    if (pool) {
      const [result] = await pool.query('DELETE FROM produtos WHERE id = ?', [produtoId]);
      deletedFromDb = result.affectedRows > 0;
    }
    
    const initialLength = MOCK_PRODUTOS.length;
    MOCK_PRODUTOS = MOCK_PRODUTOS.filter(p => p.id !== produtoId);
    delete MOCK_PRODUTO_IMAGENS[produtoId];
    
    const deletedFromMock = MOCK_PRODUTOS.length < initialLength;

    if (deletedFromDb || deletedFromMock) {
      console.log(`🗑️ Produto com ID ${produtoId} foi excluído.`);
      return res.json({ success: 'Produto excluído com sucesso!' });
    }
    
    return res.status(404).json({ error: 'Produto não encontrado' });
  } catch (error) {
    console.error('Erro ao excluir produto:', error);
    return res.status(500).json({ error: 'Erro ao excluir produto', details: error.message });
  }
});

// 7. Rota POST /checkout - Processamento com CHECKOUT TRANSPARENTE salvando endereço de entrega
app.post('/checkout', async (req, res) => {
  try {
    const { payment_method, amount, payer, card_info, items, address } = req.body;
    
    if (!payment_method || !amount || !payer || !items || items.length === 0 || !address) {
      return res.status(400).json({ error: 'Parâmetros de checkout ou endereço de entrega ausentes' });
    }

    // Extrair dados do cliente logado (se houver token)
    const clienteLogado = getClienteFromToken(req);

    // Extrair campos adicionais do endereço
    const referencia = address.referencia || '';
    const vizinhoPodeReceber = address.vizinho_pode_receber || false;
    const vizinhoNome = address.vizinho_nome || '';
    const vizinhoLocalizacao = address.vizinho_localizacao || '';

    console.log(`💳 Processando Checkout Transparente via [${payment_method.toUpperCase()}] no valor de R$ ${amount}`);
    console.log(`📍 Endereço de entrega recebido: CEP ${address.cep}, ${address.rua}, Nº ${address.numero} (${address.tipo_endereco})`);
    console.log(`📋 Referência: ${referencia} | Vizinho pode receber: ${vizinhoPodeReceber}`);
    if (clienteLogado) {
      console.log(`👤 Cliente logado: ${clienteLogado.nome_completo} (${clienteLogado.email})`);
    }

    let paymentResponse = null;
    let fallbackToSimulated = false;

    if (!process.env.MP_ACCESS_TOKEN || process.env.MP_ACCESS_TOKEN.includes('xxxxxx') || process.env.MP_ACCESS_TOKEN.includes('TEST-87654321')) {
      fallbackToSimulated = true;
    } else {
      try {
        const paymentInstance = new Payment(mpClient);

        if (payment_method === 'pix') {
          const payload = {
            body: {
              transaction_amount: Number(amount),
              description: 'Compra E-Commerce Loja Peru',
              payment_method_id: 'pix',
              payer: {
                email: payer.email,
                first_name: payer.firstName,
                last_name: payer.lastName,
                identification: {
                  type: 'CPF',
                  number: payer.cpf.replace(/\D/g, '')
                }
              }
            }
          };

          const apiResult = await paymentInstance.create(payload);
          
          paymentResponse = {
            status: apiResult.status,
            status_detail: apiResult.status_detail,
            id: apiResult.id,
            payment_method: 'pix',
            transaction_details: {
              qr_code: apiResult.point_of_interaction.transaction_data.qr_code,
              ticket_url: apiResult.point_of_interaction.transaction_data.ticket_url
            }
          };

        } else if (payment_method === 'credit_card') {
          const payload = {
            body: {
              transaction_amount: Number(amount),
              token: card_info.token,
              description: 'Compra E-Commerce Loja Peru',
              installments: Number(card_info.installments || 1),
              payment_method_id: card_info.payment_method_id,
              payer: {
                email: payer.email,
                identification: {
                  type: 'CPF',
                  number: payer.cpf.replace(/\D/g, '')
                }
              }
            }
          };

          const apiResult = await paymentInstance.create(payload);
          
          paymentResponse = {
            status: apiResult.status,
            status_detail: apiResult.status_detail,
            id: apiResult.id,
            payment_method: 'credit_card'
          };
        }
      } catch (mpError) {
        console.warn('⚠️ O SDK do Mercado Pago retornou erro. Entrando em simulação transparente:', mpError.message);
        fallbackToSimulated = true;
      }
    }

    if (fallbackToSimulated) {
      const simulatedId = Math.floor(1000000000 + Math.random() * 9000000000);
      
      if (payment_method === 'pix') {
        const mockQrCodeText = "00020101021226870014br.gov.bcb.pix2565qrcode-lojaperu-sandbox-payments.mercadopago.com/v2/pix/pay/simulated-transparent-checkout-5204000053039865802BR5915Loja_Peru_Ecom6009Sao_Paulo62070503***6304D1B9";

        paymentResponse = {
          status: 'pending',
          status_detail: 'pending_waiting_transfer',
          id: simulatedId,
          payment_method: 'pix',
          transaction_details: {
            qr_code: mockQrCodeText,
            ticket_url: `https://www.mercadopago.com.br/payments/${simulatedId}/ticket`
          }
        };
      } else {
        paymentResponse = {
          status: 'approved',
          status_detail: 'accredited',
          id: simulatedId,
          payment_method: 'credit_card'
        };
      }
    }

    // Grava as vendas e endereço de entrega no banco de dados MySQL se disponível
    if (pool) {
      try {
        const orderStatus = paymentResponse.status === 'approved' ? 'Aprovado' : 'Pendente';
        for (const item of items) {
          const total = Number(item.preco) * Number(item.quantidade);
          await pool.query(
            'INSERT INTO pedidos (produto_id, quantidade, total, status, cep, rua, numero, complemento, tipo_endereco, cliente_id, cliente_nome, cliente_cpf, cliente_email, referencia, vizinho_pode_receber, vizinho_nome, vizinho_localizacao) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
              Number(item.id),
              Number(item.quantidade),
              total,
              orderStatus,
              address.cep,
              address.rua,
              address.numero,
              address.complemento || '',
              address.tipo_endereco,
              clienteLogado ? clienteLogado.id : null,
              clienteLogado ? clienteLogado.nome_completo : (payer.firstName + ' ' + (payer.lastName || '')).trim(),
              clienteLogado ? clienteLogado.cpf : (payer.cpf || ''),
              clienteLogado ? clienteLogado.email : (payer.email || ''),
              referencia,
              vizinhoPodeReceber,
              vizinhoNome,
              vizinhoLocalizacao
            ]
          );
        }
        console.log('💾 Pedidos e endereços registrados com sucesso na tabela `pedidos` do MySQL.');
      } catch (dbError) {
        console.error('Erro ao salvar pedidos no banco de dados:', dbError.message);
      }
    }

    // Sempre registrar no mock de pedidos completos para fallback
    const orderStatus = paymentResponse.status === 'approved' ? 'Aprovado' : 'Pendente';
    for (const item of items) {
      const total = Number(item.preco) * Number(item.quantidade);
      const produtoInfo = MOCK_PRODUTOS.find(p => p.id === Number(item.id));
      const mockPedidoId = MOCK_PEDIDOS_FULL.length > 0
        ? Math.max(...MOCK_PEDIDOS_FULL.map(p => p.id)) + 1
        : 1;

      MOCK_PEDIDOS_FULL.push({
        id: mockPedidoId,
        produto_id: Number(item.id),
        produto_nome: produtoInfo ? produtoInfo.nome : (item.nome || 'Produto'),
        quantidade: Number(item.quantidade),
        total: total,
        status: orderStatus,
        cep: address.cep,
        rua: address.rua,
        numero: address.numero,
        complemento: address.complemento || '',
        tipo_endereco: address.tipo_endereco,
        cliente_id: clienteLogado ? clienteLogado.id : null,
        cliente_nome: clienteLogado ? clienteLogado.nome_completo : (payer.firstName + ' ' + (payer.lastName || '')).trim(),
        cliente_cpf: clienteLogado ? clienteLogado.cpf : (payer.cpf || ''),
        cliente_email: clienteLogado ? clienteLogado.email : (payer.email || ''),
        referencia: referencia,
        vizinho_pode_receber: vizinhoPodeReceber,
        vizinho_nome: vizinhoNome,
        vizinho_localizacao: vizinhoLocalizacao,
        criado_em: new Date().toISOString()
      });
    }

    res.json(paymentResponse);

  } catch (error) {
    console.error('Erro geral no processamento do checkout transparente:', error);
    res.status(500).json({ 
      error: 'Erro interno ao processar o pagamento transparente', 
      details: error.message 
    });
  }
});

// Inicia o servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`👉 Vitrine ativa em: http://localhost:${PORT}`);
  console.log(`⚙️  Área de admin ativa em: http://localhost:${PORT}/admin.html`);
});
