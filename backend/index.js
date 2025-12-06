import express from "express";
import cors from "cors";
import { GraphQLClient, gql } from "graphql-request";

const app = express();
app.use(cors());

// INSERT YOUR REAL API KEY HERE
const API_KEY = "daffcbf57d011d81843319f8404b37bd";

// Uniswap V3 subgraph ID you confirmed works
const SUBGRAPH_ID = "5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV";

// Full The Graph Gateway endpoint
const client = new GraphQLClient(
  `https://gateway.thegraph.com/api/${API_KEY}/subgraphs/id/${SUBGRAPH_ID}`,
  {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
    },
  }
);

// Query: Last 24 hours of price data
const QUERY = gql`
  query ($id: ID!) {
    poolHourDatas(
      first: 24
      where: { pool: $id }
      orderBy: periodStartUnix
      orderDirection: desc
    ) {
      periodStartUnix
      sqrtPrice
    }
  }
`;

// API endpoint: GET /poolHour?pool=<poolAddress>
app.get("/poolHour", async (req, res) => {
  try {
    const poolId = req.query.pool;
    const data = await client.request(QUERY, { id: poolId });
    res.json(data);
  } catch (err) {
    console.error("Graph Error:", err);
    res.status(500).json({ error: err.toString() });
  }
});

// Start server
app.listen(3000, () => {
  console.log("Backend running on port 3000");
});
