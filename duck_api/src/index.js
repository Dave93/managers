"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var dotenv = require('dotenv');
var cron = require('node-cron');
var duckdb_async_1 = require("duckdb-async");
var node_server_1 = require("@hono/node-server");
var hono_1 = require("hono");
var token_1 = require("./token");
var terminal_1 = require("./syncs/terminal");
var transportToken_1 = require("./transportToken");
var organization_1 = require("./syncs/organization");
var categories_1 = require("./syncs/categories");
var products_1 = require("./syncs/products");
var zod_validator_1 = require("@hono/zod-validator");
var zod_1 = require("zod");
var uuid_1 = require("uuid");
var dayjs_1 = require("dayjs");
dotenv.config();
(function () { return __awaiter(void 0, void 0, void 0, function () {
    var db, syncAlldata, app, port;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, duckdb_async_1.Database.create(process.env.DUCK_PATH)];
            case 1:
                db = _a.sent();
                syncAlldata = function () { return __awaiter(void 0, void 0, void 0, function () {
                    var token, _a, lesToken, choparToken;
                    return __generator(this, function (_b) {
                        switch (_b.label) {
                            case 0: return [4 /*yield*/, (0, token_1.getToken)()];
                            case 1:
                                token = _b.sent();
                                return [4 /*yield*/, (0, transportToken_1.getTransportToken)()];
                            case 2:
                                _a = _b.sent(), lesToken = _a.lesToken, choparToken = _a.choparToken;
                                return [4 /*yield*/, (0, terminal_1.syncTerminal)(db, lesToken, choparToken)];
                            case 3:
                                _b.sent();
                                return [4 /*yield*/, (0, organization_1.syncOrganizations)(db, lesToken, choparToken)];
                            case 4:
                                _b.sent();
                                return [4 /*yield*/, (0, categories_1.syncCategories)(db, token)];
                            case 5:
                                _b.sent();
                                return [4 /*yield*/, (0, products_1.syncProducts)(db, token)];
                            case 6:
                                _b.sent();
                                return [4 /*yield*/, db.exec("\n    CREATE TABLE IF NOT EXISTS \"stoplist\" (\n        \"id\" UUID PRIMARY KEY,\n        \"productId\" UUID,\n        \"terminalId\" UUID,\n        \"organizationId\" UUID,\n        \"dateAdd\" TIMESTAMP,\n        \"dateRemoved\" TIMESTAMP,\n        \"status\" STRING,\n        \"difference\" INTEGER,\n        \"reason\" STRING,\n        \"responsible\" STRING,\n        \"comment\" TEXT,\n        \"solve_status\" STRING\n\n    );\n    ")];
                            case 7:
                                _b.sent();
                                return [2 /*return*/];
                        }
                    });
                }); };
                app = new hono_1.Hono();
                // await syncAlldata();
                cron.schedule('0 1/* * * *', function () { return __awaiter(void 0, void 0, void 0, function () {
                    return __generator(this, function (_a) {
                        switch (_a.label) {
                            case 0: 
                            // running syncs every hour
                            return [4 /*yield*/, syncAlldata()];
                            case 1:
                                // running syncs every hour
                                _a.sent();
                                return [2 /*return*/];
                        }
                    });
                }); });
                app.get('/', function (c) { return __awaiter(void 0, void 0, void 0, function () {
                    return __generator(this, function (_a) {
                        return [2 /*return*/, c.text('Hello, world!')];
                    });
                }); });
                app.post('/stoplist/list', (0, zod_validator_1.zValidator)('json', zod_1.z.object({
                    limit: zod_1.z.number(),
                    offset: zod_1.z.number(),
                    filter: zod_1.z.array(zod_1.z.object({
                        field: zod_1.z.string(),
                        operator: zod_1.z.string(),
                        value: zod_1.z.string()
                    })),
                })), function (c) { return __awaiter(void 0, void 0, void 0, function () {
                    var _a, limit, offset, filter, where, sqlQuery, sqlCount, data, count;
                    return __generator(this, function (_b) {
                        switch (_b.label) {
                            case 0: return [4 /*yield*/, c.req.json()];
                            case 1:
                                _a = _b.sent(), limit = _a.limit, offset = _a.offset, filter = _a.filter;
                                where = '';
                                if (filter.length > 0) {
                                    where = "WHERE ".concat(filter.map(function (item) {
                                        switch (item.operator) {
                                            case 'contains':
                                                return "".concat(item.field, " LIKE '%").concat(item.value, "%'");
                                            case 'eq':
                                                return "".concat(item.field, " = '").concat(item.value, "'");
                                            case 'gt':
                                                return "".concat(item.field, " > '").concat(item.value, "'");
                                            case 'lt':
                                                return "".concat(item.field, " < '").concat(item.value, "'");
                                            case 'gte':
                                                return "".concat(item.field, " >= '").concat(item.value, "'");
                                            case 'lte':
                                                return "".concat(item.field, " <= '").concat(item.value, "'");
                                            default:
                                                return "".concat(item.field, " ").concat(item.operator, " '").concat(item.value, "'");
                                        }
                                    }).join(' AND '));
                                }
                                sqlQuery = "\n      SELECT\n      stoplist.*,\n      terminal.name as terminalName,\n      categories.name as categoryName,\n      products.name as productName\n      FROM stoplist\n      LEFT JOIN terminal ON terminal.id = stoplist.terminalId\n      LEFT JOIN products ON products.id = stoplist.productId\n      LEFT JOIN categories ON categories.id = products.category\n      ".concat(where, "\n      ORDER BY dateAdd DESC\n      LIMIT ").concat(limit, "\n      OFFSET ").concat(offset, ";\n    ");
                                console.log('query', sqlQuery);
                                sqlCount = "\n       SELECT count(*) as cnt FROM\n      stoplist\n      LEFT JOIN terminal ON terminal.id = stoplist.terminalId\n      LEFT JOIN products ON products.id = stoplist.productId\n      LEFT JOIN categories ON categories.id = products.category\n      ".concat(where, ";\n    ");
                                return [4 /*yield*/, db.all(sqlQuery)];
                            case 2:
                                data = _b.sent();
                                return [4 /*yield*/, db.all(sqlCount)];
                            case 3:
                                count = _b.sent();
                                // console.log('stoplist data', data)
                                console.log('stoplist count', count);
                                return [2 /*return*/, c.json({
                                        data: data,
                                        total: Number(count[0].cnt)
                                    })];
                        }
                    });
                }); });
                app.post('/stoplist', (0, zod_validator_1.zValidator)('json', zod_1.z.object({
                    stops: zod_1.z.array(zod_1.z.object({
                        terminalId: zod_1.z.string(),
                        productId: zod_1.z.string(),
                        dateAdd: zod_1.z.string()
                    }))
                })), function (c) { return __awaiter(void 0, void 0, void 0, function () {
                    var stops, terminalId, terminal, sqlQuery, data, toAdd, toRemove, insertQuery, removeQuery;
                    return __generator(this, function (_a) {
                        switch (_a.label) {
                            case 0: return [4 /*yield*/, c.req.json()];
                            case 1:
                                stops = (_a.sent()).stops;
                                terminalId = stops[0].terminalId;
                                return [4 /*yield*/, db.all("SELECT * FROM terminal WHERE id = '".concat(terminalId, "'"))];
                            case 2:
                                terminal = (_a.sent())[0];
                                sqlQuery = "SELECT * FROM stoplist WHERE status = 'stop'";
                                return [4 /*yield*/, db.all(sqlQuery)];
                            case 3:
                                data = _a.sent();
                                toAdd = stops.filter(function (stop) { return !data.some(function (item) { return item.terminalId === stop.terminalId && item.productId === stop.productId; }); });
                                toRemove = data.filter(function (item) { return !stops.some(function (stop) { return stop.terminalId === item.terminalId && stop.productId === item.productId; }); });
                                console.log('toAdd', toAdd);
                                insertQuery = "\n      ".concat(toAdd.map(function (item) {
                                    var date = new Date(item.dateAdd);
                                    date.setHours(date.getHours() + 5);
                                    return "INSERT INTO stoplist (id, productId, terminalId, dateAdd, status, organizationId, solve_status) VALUES ('".concat((0, uuid_1.v4)(), "', '").concat(item.productId, "', '").concat(item.terminalId, "', '").concat(date.toISOString(), "', 'stop', '").concat(terminal.organizationId, "', 'new')");
                                }).join('; '), ";\n    ");
                                removeQuery = "\n      ".concat(toRemove.map(function (item) {
                                    var difference = (0, dayjs_1.default)().add(5, 'hour').diff((0, dayjs_1.default)(item.dateAdd), 'minute');
                                    return "UPDATE stoplist SET status = 'available', dateRemoved = '".concat((0, dayjs_1.default)().add(5, 'hour').toISOString(), "', difference = ").concat(difference, " WHERE id = '").concat(item.id, "'");
                                }).join('; '), ";\n    ");
                                if (!(toAdd.length > 0)) return [3 /*break*/, 5];
                                console.log('insertQuery', insertQuery);
                                return [4 /*yield*/, db.all(insertQuery)];
                            case 4:
                                _a.sent();
                                _a.label = 5;
                            case 5:
                                if (!(toRemove.length > 0)) return [3 /*break*/, 7];
                                console.log('removeQuery', removeQuery);
                                return [4 /*yield*/, db.all(removeQuery)];
                            case 6:
                                _a.sent();
                                _a.label = 7;
                            case 7:
                                console.log('trying to response some data');
                                return [2 /*return*/, c.json({
                                        success: true
                                    })];
                        }
                    });
                }); });
                port = 9999;
                console.log("Server is running on port ".concat(port));
                (0, node_server_1.serve)({
                    fetch: app.fetch,
                    port: port
                });
                return [2 /*return*/];
        }
    });
}); })();
