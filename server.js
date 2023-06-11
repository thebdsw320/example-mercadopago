const express = require("express");
const AWS = require("aws-sdk");
const {v4: uuidv4} = require("uuid");
const app = express();
const cors = require("cors");
const mercadopago = require("mercadopago");

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static("../../client/html-js"));
app.use(cors(
	{
		origin: "*",
	}
));

// REPLACE WITH YOUR ACCESS TOKEN AVAILABLE IN: https://developers.mercadopago.com/panel
mercadopago.configure({
	access_token: "TEST-6443778252675198-050619-bc7a2c439258e7355456d4ac3e453cef-87432336",
});

AWS.config.update({
	region: "us-east-2",
	accessKeyId: "AKIAZPK45TXJZV22JMZA",
	secretAccessKey: "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",
});

const dynamodb = new AWS.DynamoDB.DocumentClient();

async function createOrder(order) {
	try {	
		const params = {
			TableName: "Compras-Boonil",
			Item: order,
		};

		const result =  await dynamodb.put(params).promise();
		console.log("Order created successfully ", result);
	}
	catch (err) {
		console.error("Error", err);
	}
}

async function updatePaidStatusOrder(orderId) {
	try {
		const params = {
			TableName: "Compras-Boonil",
			Key: {
				Id: orderId,
			},
			UpdateExpression: "set Paid = :p",
			ExpressionAttributeValues: {
				":p": true,
			},
		};

		const result = await dynamodb.update(params).promise();
		console.log("Order updated successfully ", result);
	}
	catch (err) {
		console.error("Error", err);
	}
}

app.get("/", function (req, res) {
	res.status(200).sendFile("index.html");
});

app.post("/create_order", (req, res) => {
	let order = {
		Items: req.body.items,
		UserId: req.body.userId,
		Id: uuidv4(),
		CreatedAt: Date.now(),
		Paid: false,
	};

	createOrder(order);

	res.json({
		id: order.Id,
		created_at: order.CreatedAt,
		paid: order.Paid,
	});
});

app.post("/create_preference", (req, res) => {
	let preference = {
		items: req.body.items,
		back_urls: {
			"success": "http://localhost:8080/feedback",
			"failure": "http://localhost:8080/feedback",
			"pending": "http://localhost:8080/feedback"
		},
		auto_return: "approved",
		metadata: {
			"orderId": req.body.id
		}
	};

	mercadopago.preferences.create(preference)
		.then(function (response) {
			res.json({
				id: response.body.id
			});
		}).catch(function (error) {
			console.log(error);
		});
});

app.get('/feedback', function (req, res) {
	res.json({
		Payment: req.query.payment_id,
		Status: req.query.status,
		MerchantOrder: req.query.merchant_order_id
	});
});

app.listen(8080, () => {
	console.log("The server is now running on Port 8080");
});

app.post("/webhook", (req, res) => {
	const {
		data: { id },
		type,
	} = req.body;

	console.log("Received webhook");
	console.log(id);

	if (type === "payment") {
		try {
			mercadopago.payment.get(id).then((payment) => {
			const paymentData = payment.response;
			console.log(paymentData);

			const { metadata: { orderId } } = paymentData;
			console.log(orderId);

			if (paymentData.status === "approved" && paymentData.status_detail === "accredited") {
				updatePaidStatusOrder(orderId);

				res.json({received: true, updated: true});
				res.status(200).send();
			}
		})}
		catch (err) {
			console.error("Error", err);
			res.status(500).send();
		}
	}
});

module.exports = app;