const express = require("express");
const AWS = require("aws-sdk");
const {v4: uuidv4} = require("uuid");
const app = express();
const cors = require("cors");
const mercadopago = require("mercadopago");
const axios = require("axios");

const shippingAPI = "https://fjwrbcvro1.execute-api.us-east-2.amazonaws.com/dev";
const couponAPI = "https://lzwmliiczj.execute-api.us-east-2.amazonaws.com/dev";

AWS.config.update({ 
	region: "us-east-2",
	accessKeyId: "AKIASJSARUPK26JEUKP3",
	secretAccessKey: "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",
 });

dynamodb = new AWS.DynamoDB.DocumentClient();

mercadopago.configure({
	access_token: "TEST-6443778252675198-050619-bc7a2c439258e7355456d4ac3e453cef-87432336",
});

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cors(
	{
		origin: "*",
	}
));

async function createShipment(shippingData) {
	const data = {
		State: shippingData.state,
		PostalCode: shippingData.postalCode,
		City: shippingData.city,
		Street: shippingData.street,
		Phone: shippingData.phone,
		Email: shippingData.email,
		Name: shippingData.name,
		Number: shippingData.number,
		Reference: shippingData.reference,
		Carrier: shippingData.carrier,
		Service: shippingData.service,
	};

	const response = await axios.post(`${shippingAPI}/generate`, data)
		.then((response) => {
			console.log(response.data);
			return response;
		})
		.catch((error) => {
			console.log(error);
		}
	);

	if (response.status === 200) {
		return response.data;
	}
}

async function getOrderData(orderId) {
	try {
		const params = {
			TableName: "Compras-Boonil",
			Key: {
				Id: orderId,
			},
		};

		const { Item } = await dynamodb.get(params).promise();
		return Item;
	}
	catch (err) {
		console.error("Error", err);
	}
}

async function getPaymentData(paymentId) {
	try {
		const { data } = await axios.get(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
			headers: {
				Authorization: "Bearer TEST-6443778252675198-050619-bc7a2c439258e7355456d4ac3e453cef-87432336",
			},
		});
		
        return data;
	}
	catch (err) {
		console.error("Error", err);
	}
}

async function createOrder(order) {
	try {	
		const params = {
			TableName: "Compras-Boonil",
			Item: order,
		};

		console.log("Adding a new item...", params)

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

async function updateLabelData(orderId, labelData) {
	try {
		const params = {
			TableName: "Compras-Boonil",
			Key: {
				Id: orderId,
			},
			UpdateExpression: "set Label = :s",
			ExpressionAttributeValues: {
				":s": labelData,
			},
		};

		const result = await dynamodb.update(params).promise();
		console.log("Label data updated successfully ", result);
	}
	catch (err) {
		console.error("Error", err);
	}
}

app.get("/", function (req, res) {
	res.json({ message: "Hello World" });
	res.status(200);
});

app.post("/create_order", async (req, res) => {
	res.set("Allow-Access-Control-Origin", "*")

	let order = {
		Items: req.body.items,
		UserId: req.body.userId,
		DiscountCode: req.body.discountCode,
		Id: uuidv4(),
		CreatedAt: Date.now(),
		Paid: false,
		ShippingData: req.body.shipping,
	};

	console.log(order);

	await createOrder(order);

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
			"order_id": req.body.id,
			"discount_code": req.body.discountCode,
		},
		notification_url: "https://example-mercadopago.vercel.app/webhook",
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

app.post("/webhook", async (req, res) => {
	const {
		data: { id },
		type,
	} = req.body;

	console.log("Received webhook");
	console.log(id);

	if (type === "payment") {
		try {
			await getPaymentData(id).then(async (payment) => {
				console.log("Payment data", payment);
				const { metadata: { order_id, discount_code } } = payment;
				const { status, status_detail } = payment;

				if (status === "approved" && status_detail === "accredited") {
					await updatePaidStatusOrder(order_id);
					const orderData = await getOrderData(order_id);

					console.log("Shipping data", orderData.ShippingData);
					console.log("Discount code ", discount_code);

					await createShipment(orderData.ShippingData).then(async (labelData) => {
						console.log("Label data", labelData);
						await updateLabelData(order_id, labelData);
					});

					if (discount_code) {
						await axios.post(`${couponAPI}/coupon/redeem`, {
							Code: discount_code,
							UserId: payment.metadata.user_id,
						});
					}

					res.status(200).send();
				}
			});
		}
		catch (err) {
			console.error("Error", err);
			res.status(500).send();
		}
	}
	res.status(200).send();
});

app.listen(8080, () => {
	console.log("The server is now running on Port 8080");
});

module.exports = app;