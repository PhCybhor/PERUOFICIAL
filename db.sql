-- Script de Criação do Banco de Dados para Loja Peru
-- Pronto para colar no MySQL Shell ou executar via cliente MySQL

CREATE DATABASE IF NOT EXISTS loja_peru;
USE loja_peru;

-- Criar tabela de categorias dinâmicas
CREATE TABLE IF NOT EXISTS categorias (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(100) NOT NULL UNIQUE
);

-- Criar tabela de produtos
CREATE TABLE IF NOT EXISTS produtos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  descricao TEXT,
  preco DECIMAL(10, 2) NOT NULL,
  imagem_url VARCHAR(255),
  categoria VARCHAR(100),
  cores VARCHAR(255) DEFAULT 'Padrão'
);

-- Criar tabela de clientes (cadastro com autenticação)
CREATE TABLE IF NOT EXISTS clientes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome_completo VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  cpf VARCHAR(14) NOT NULL UNIQUE,
  telefone VARCHAR(20),
  senha_hash VARCHAR(255) NOT NULL,
  senha_salt VARCHAR(255) NOT NULL,
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Criar tabela de pedidos com campos de endereço de entrega (Checkout Transparente)
CREATE TABLE IF NOT EXISTS pedidos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  produto_id INT,
  quantidade INT,
  total DECIMAL(10, 2),
  status VARCHAR(50) DEFAULT 'Pendente',
  cep VARCHAR(20),
  rua VARCHAR(255),
  numero VARCHAR(50),
  complemento VARCHAR(255),
  tipo_endereco VARCHAR(50),
  cliente_id INT,
  cliente_nome VARCHAR(255),
  cliente_cpf VARCHAR(14),
  cliente_email VARCHAR(255),
  referencia VARCHAR(255),
  vizinho_pode_receber BOOLEAN DEFAULT FALSE,
  vizinho_nome VARCHAR(255),
  vizinho_localizacao VARCHAR(255),
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE CASCADE,
  FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE SET NULL
);

-- Criar tabela de imagens adicionais de produtos para galeria
CREATE TABLE IF NOT EXISTS produto_imagens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  produto_id INT,
  imagem_url VARCHAR(255) NOT NULL,
  FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE CASCADE
);

-- Inserir categorias dinâmicas iniciais
INSERT IGNORE INTO categorias (nome) VALUES 
('Roupas'), 
('Acessórios');

-- Inserir produtos de teste (2 roupas e 2 acessórios de tecnologia) com as cores correspondentes
INSERT INTO produtos (id, nome, descricao, preco, imagem_url, categoria, cores) VALUES
(1, 'Poncho Premium de Alpaca', 'Poncho tradicional peruano confeccionado em pura lã de alpaca, oferecendo conforto térmico incomparável, leveza e um design contemporâneo nas cores vermelho e nude.', 389.90, '/images/alpaca_poncho.svg', 'Roupas', 'Padrão, Vermelho, Nude'),
(2, 'Camiseta Algodão Pima Peruano', 'Camiseta confeccionada em algodão Pima 100% peruano, reconhecido mundialmente pela maciez extrema e alta durabilidade. Detalhe minimalista no bolso.', 149.90, '/images/peruvian_tshirt.svg', 'Roupas', 'Sand, Vermelho, Preto'),
(3, 'Case de Couro Andes para iPhone', 'Capa premium protetora feita à mão com couro legítimo nobre e costura contrastante vermelha. Compatível com MagSafe.', 189.90, '/images/phone_case.svg', 'Acessórios', 'Tan, Preto, Vermelho'),
(4, 'Headphones Sem Fio Andes Pro', 'Headphones sem fio de alta fidelidade com cancelamento de ruído ativo. Acabamento sofisticado na cor nude com detalhes em vermelho fosco e almofadas de couro.', 599.90, '/images/wireless_headphones.svg', 'Acessórios', 'Nude, Vermelho, Preto')
ON DUPLICATE KEY UPDATE nome=VALUES(nome), cores=VALUES(cores);

-- Inserir imagens secundárias de teste para a galeria
INSERT INTO produto_imagens (produto_id, imagem_url) VALUES
(1, '/images/alpaca_poncho.svg'),
(1, '/images/peruvian_tshirt.svg'),
(1, '/images/phone_case.svg'),

(2, '/images/peruvian_tshirt.svg'),
(2, '/images/alpaca_poncho.svg'),

(3, '/images/phone_case.svg'),
(3, '/images/wireless_headphones.svg'),

(4, '/images/wireless_headphones.svg'),
(4, '/images/phone_case.svg'),
(4, '/images/alpaca_poncho.svg')
ON DUPLICATE KEY UPDATE imagem_url=VALUES(imagem_url);
