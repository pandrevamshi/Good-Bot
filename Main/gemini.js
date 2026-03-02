import { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously } from 'firebase/auth';
import { getFirestore, doc, setDoc, collection, query, where, getDocs, addDoc, serverTimestamp, onSnapshot } from 'firebase/firestore';

// Main App component
export default function App() {
  // --- STATE MANAGEMENT ---
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [transactions, setTransactions] = useState([]);
  const [chatHistory, setChatHistory] = useState([]);
  const [transactionInput, setTransactionInput] = useState({
    amount: '',
    type: 'expense',
    account: '',
    currency: 'USD',
    description: '',
  });
  const [userMessage, setUserMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const chatEndRef = useRef(null);
  const [invoiceDetails, setInvoiceDetails] = useState(null);

  // --- FIREBASE INITIALIZATION & AUTHENTICATION ---
  useEffect(() => {
    async function initFirebase() {
      try {
        // Retrieve and parse Firebase config from global variables
        const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
        
        // Initialize Firebase services
        const app = initializeApp(firebaseConfig);
        const firestore = getFirestore(app);
        const firebaseAuth = getAuth(app);
        
        setDb(firestore);
        setAuth(firebaseAuth);

        // Sign in with the custom token or anonymously
        if (typeof __initial_auth_token !== 'undefined') {
          await signInWithCustomToken(firebaseAuth, __initial_auth_token);
        } else {
          await signInAnonymously(firebaseAuth);
        }

        // Set up the authentication state listener
        const unsubscribe = firebaseAuth.onAuthStateChanged(user => {
          if (user) {
            setUserId(user.uid);
            setIsAuthReady(true);
            console.log('User authenticated:', user.uid);
          } else {
            console.error('Authentication failed.');
          }
        });
        
        return () => unsubscribe();
      } catch (e) {
        console.error("Error initializing Firebase:", e);
      }
    }
    initFirebase();
  }, []);

  // --- DATA FETCHING & REAL-TIME LISTENER ---
  useEffect(() => {
    if (isAuthReady && db && userId) {
      const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
      const userTransactionsCollection = collection(db, `/artifacts/${appId}/users/${userId}/transactions`);
      
      // Listen for real-time updates to the transactions collection
      const unsubscribe = onSnapshot(userTransactionsCollection, (querySnapshot) => {
        const fetchedTransactions = [];
        querySnapshot.forEach((doc) => {
          fetchedTransactions.push({ id: doc.id, ...doc.data() });
        });
        // Sort by date descending
        setTransactions(fetchedTransactions.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0)));
      }, (error) => {
        console.error("Error fetching transactions:", error);
      });

      return () => unsubscribe();
    }
  }, [isAuthReady, db, userId]);

  // --- UI SCROLL MANAGEMENT ---
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  // --- AGENT TOOL DEFINITIONS (Function Calling) ---
  // The tools your agent can use to interact with the world
  const tools = [
    {
      name: "addTransaction",
      description: "Adds a new income or expense transaction to the user's financial record.",
      parameters: {
        type: "object",
        properties: {
          amount: {
            type: "number",
            description: "The amount of the transaction. Must be a positive number.",
          },
          type: {
            type: "string",
            description: "The type of transaction, either 'income' or 'expense'.",
            enum: ["income", "expense"],
          },
          account: {
            type: "string",
            description: "The financial account associated with the transaction (e.g., 'Checking', 'Savings', 'Credit Card').",
          },
          description: {
            type: "string",
            description: "A short description of the transaction (e.g., 'Groceries', 'Salary', 'Rent').",
          },
        },
        required: ["amount", "type", "account", "description"],
      },
    },
    {
      name: "addRemittance",
      description: "Adds a remittance transaction between two accounts. This involves a withdrawal from one account and a deposit into another.",
      parameters: {
        type: "object",
        properties: {
          fromAccount: {
            type: "string",
            description: "The account from which the money is sent.",
          },
          toAccount: {
            type: "string",
            description: "The account to which the money is received.",
          },
          fromAmount: {
            type: "number",
            description: "The amount of money sent from the source account.",
          },
          fromCurrency: {
            type: "string",
            description: "The currency of the money sent (e.g., 'USD', 'EUR').",
          },
          toAmount: {
            type: "number",
            description: "The amount of money received in the destination account.",
          },
          toCurrency: {
            type: "string",
            description: "The currency of the money received (e.g., 'INR', 'JPY').",
          },
          description: {
            type: "string",
            description: "A short description of the remittance (e.g., 'USD to INR transfer').",
          },
        },
        required: ["fromAccount", "toAccount", "fromAmount", "fromCurrency", "toAmount", "toCurrency", "description"],
      },
    },
    {
      name: "getTransactions",
      description: "Retrieves a summary of transactions based on user-specified criteria. Useful for questions about total expenses, total income, or transactions in a specific period.",
      parameters: {
        type: "object",
        properties: {
          startDate: {
            type: "string",
            description: "The start date for the query in YYYY-MM-DD format. Optional.",
          },
          endDate: {
            type: "string",
            description: "The end date for the query in YYYY-MM-DD format. Optional.",
          },
          account: {
            type: "string",
            description: "The financial account to filter by (e.g., 'Checking', 'Savings'). Optional.",
          },
          type: {
            type: "string",
            description: "The type of transaction to filter by, either 'income' or 'expense'. Optional.",
            enum: ["income", "expense"],
          },
        },
      },
    },
    {
      name: "getAccounts",
      description: "Lists all unique accounts that have been used in past transactions.",
      parameters: { type: "object", properties: {} },
    }
  ];

  // --- TOOL IMPLEMENTATION (Functions the agent can call) ---
  // These are the actual functions that interact with Firestore.
  const handleToolCall = async (call) => {
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    const transactionsCollection = collection(db, `/artifacts/${appId}/users/${userId}/transactions`);

    // The Gemini model will call one of these based on user input
    switch (call.name) {
      case "addTransaction":
        try {
          // Add a new document to the transactions collection
          const newTransaction = {
            ...call.args,
            timestamp: serverTimestamp(),
          };
          await addDoc(transactionsCollection, newTransaction);
          return {
            name: "addTransaction",
            content: `Successfully added ${call.args.type} of ${call.args.amount} to ${call.args.account}.`,
          };
        } catch (error) {
          console.error("Error adding transaction:", error);
          return {
            name: "addTransaction",
            content: "Failed to add transaction due to a database error.",
          };
        }
      
      case "addRemittance":
        try {
          const { fromAccount, toAccount, fromAmount, fromCurrency, toAmount, toCurrency, description } = call.args;
          const timestamp = serverTimestamp();

          // Add the withdrawal from the source account
          await addDoc(transactionsCollection, {
            amount: fromAmount,
            currency: fromCurrency,
            type: 'expense',
            account: fromAccount,
            description: `${description} (sent)`,
            timestamp: timestamp,
          });

          // Add the deposit to the destination account
          await addDoc(transactionsCollection, {
            amount: toAmount,
            currency: toCurrency,
            type: 'income',
            account: toAccount,
            description: `${description} (received)`,
            timestamp: timestamp,
          });
          
          return {
            name: "addRemittance",
            content: `Successfully recorded remittance: ${fromAmount} ${fromCurrency} sent from ${fromAccount} and ${toAmount} ${toCurrency} received in ${toAccount}.`,
          };
        } catch (error) {
          console.error("Error adding remittance:", error);
          return {
            name: "addRemittance",
            content: "Failed to add remittance due to a database error.",
          };
        }

      case "getTransactions":
        try {
          const { startDate, endDate, account, type } = call.args;
          let transactionQuery = query(transactionsCollection);

          if (startDate) {
            transactionQuery = query(transactionQuery, where("timestamp", ">=", new Date(startDate)));
          }
          if (endDate) {
            transactionQuery = query(transactionQuery, where("timestamp", "<=", new Date(endDate)));
          }
          if (account) {
            transactionQuery = query(transactionQuery, where("account", "==", account));
          }
          if (type) {
            transactionQuery = query(transactionQuery, where("type", "==", type));
          }

          const querySnapshot = await getDocs(transactionQuery);
          let results = [];
          querySnapshot.forEach(doc => results.push(doc.data()));

          const totalAmount = results.reduce((sum, t) => sum + (t.amount || 0), 0);
          
          let responseText = `You have a total of ${results.length} transactions.`;
          if (totalAmount > 0) {
            responseText += ` Total amount is ${totalAmount.toFixed(2)}.`;
          }
          if (results.length > 0) {
            const firstThree = results.slice(0, 3);
            responseText += " Here are the first 3 results: " + firstThree.map(t => `${t.description} (${t.amount} from ${t.account})`).join(", ") + ".";
          } else {
            responseText += " No transactions found for this query.";
          }

          return {
            name: "getTransactions",
            content: responseText,
          };
        } catch (error) {
          console.error("Error getting transactions:", error);
          return {
            name: "getTransactions",
            content: "Failed to retrieve transactions due to a database error.",
          };
        }
      
      case "getAccounts":
        try {
          const querySnapshot = await getDocs(transactionsCollection);
          const accounts = new Set();
          querySnapshot.forEach(doc => {
            const data = doc.data();
            if (data.account) {
              accounts.add(data.account);
            }
          });
          const accountList = Array.from(accounts).join(', ');
          return {
            name: "getAccounts",
            content: `Your current accounts are: ${accountList}.`,
          };
        } catch (error) {
          console.error("Error getting accounts:", error);
          return {
            name: "getAccounts",
            content: "Failed to retrieve accounts due to a database error.",
          };
        }

      default:
        return {
          name: call.name,
          content: `No tool found with the name: ${call.name}`,
        };
    }
  };

  // --- API CALL TO GEMINI ---
  const callGeminiApi = async (messages) => {
    setIsTyping(true);
    const apiKey = "";
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

    const payload = {
      contents: messages,
      tools: tools,
    };

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      return result;
    } catch (error) {
      console.error('Error calling Gemini API:', error);
      setIsTyping(false);
      return null;
    }
  };

  // --- CORE CONVERSATION LOOP ---
  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!userMessage.trim()) return;

    const newUserMessage = { role: 'user', parts: [{ text: userMessage }] };
    setChatHistory((prev) => [...prev, newUserMessage]);
    setUserMessage('');

    let currentMessages = [...chatHistory, newUserMessage];

    try {
      let response = await callGeminiApi(currentMessages);
      let candidates = response.candidates || [];
      
      // Agent's turn to respond
      while (candidates.length > 0) {
        let firstCandidate = candidates[0];
        let hasToolCalls = firstCandidate.content?.parts?.some(p => p.functionCall);

        if (hasToolCalls) {
          // The agent wants to call a tool
          const toolCalls = firstCandidate.content.parts.filter(p => p.functionCall).map(p => p.functionCall);
          const toolResponses = await Promise.all(toolCalls.map(handleToolCall));

          // Add the tool call and response to the chat history
          currentMessages.push({
            role: 'model',
            parts: firstCandidate.content.parts,
          });
          currentMessages.push({
            role: 'tool',
            parts: toolResponses.map(res => ({
              functionResponse: {
                name: res.name,
                response: res.content,
              }
            }))
          });
          setChatHistory(currentMessages);

          // Get the next response from the agent, with the new tool output
          response = await callGeminiApi(currentMessages);
          candidates = response.candidates || [];
        } else {
          // The agent is sending a final text message
          if (firstCandidate.content?.parts?.[0]?.text) {
            const botMessage = { role: 'model', parts: [{ text: firstCandidate.content.parts[0].text }] };
            setChatHistory(prev => [...prev, botMessage]);
          }
          break; // End the loop
        }
      }
    } catch (error) {
      console.error('Error in conversation loop:', error);
      const errorMessage = { role: 'model', parts: [{ text: "I'm sorry, an error occurred. Please try again." }] };
      setChatHistory(prev => [...prev, errorMessage]);
    } finally {
      setIsTyping(false);
    }
  };

  // --- NEW AI FEATURES ---
  const handleGenerateSummary = async () => {
    setIsTyping(true);
    const apiKey = "";
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

    // Format transaction data for the LLM prompt
    const transactionData = transactions.map(t => {
      const date = t.timestamp ? new Date(t.timestamp.seconds * 1000).toLocaleDateString() : 'N/A';
      return `Date: ${date}, Type: ${t.type}, Amount: ${t.amount} ${t.currency || ''}, Account: ${t.account}, Description: ${t.description}`;
    }).join('\n');

    const prompt = `Analyze the following financial transactions and provide a short, narrative summary of the user's spending and savings habits. Identify any noticeable trends, such as high spending categories or consistent income sources. Be concise and friendly.
    Transactions:\n${transactionData}`;

    const payload = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }]
    };

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      const summaryText = result.candidates?.[0]?.content?.parts?.[0]?.text;

      if (summaryText) {
        setChatHistory(prev => [...prev, { role: 'model', parts: [{ text: summaryText }] }]);
      } else {
        setChatHistory(prev => [...prev, { role: 'model', parts: [{ text: "Sorry, I couldn't generate a summary at this time." }] }]);
      }
    } catch (error) {
      console.error("Error generating summary:", error);
      setChatHistory(prev => [...prev, { role: 'model', parts: [{ text: "Sorry, an error occurred while generating the summary." }] }]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleGenerateInvoice = async () => {
    // Prompt the user for details through the chat input
    const client = prompt("Please enter the client's name:");
    const service = prompt("Please enter a description of the service:");
    const amount = prompt("Please enter the total amount:");

    if (!client || !service || !amount) {
      setChatHistory(prev => [...prev, { role: 'model', parts: [{ text: "Invoice generation cancelled." }] }]);
      return;
    }

    setIsTyping(true);
    const apiKey = "";
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;
    
    const promptText = `Generate a professional invoice for a client.
    Client: ${client}
    Service: ${service}
    Amount: ${amount}
    
    The invoice should include:
    - Your company name (e.g., "Freelance Services")
    - An invoice number (e.g., INVOICE-001)
    - Date of issue
    - The client's name and a generic address
    - A clear description of the service rendered
    - The total amount due
    - A simple "Thank you for your business!" message.
    Format the output to be easily readable in a chat window. Use a clean, professional tone.`;

    const payload = {
      contents: [{ role: 'user', parts: [{ text: promptText }] }]
    };

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      const invoiceText = result.candidates?.[0]?.content?.parts?.[0]?.text;
      if (invoiceText) {
        setChatHistory(prev => [...prev, { role: 'model', parts: [{ text: invoiceText }] }]);
      } else {
        setChatHistory(prev => [...prev, { role: 'model', parts: [{ text: "Sorry, I couldn't generate the invoice at this time." }] }]);
      }
    } catch (error) {
      console.error("Error generating invoice:", error);
      setChatHistory(prev => [...prev, { role: 'model', parts: [{ text: "Sorry, an error occurred while generating the invoice." }] }]);
    } finally {
      setIsTyping(false);
    }
  };

  // --- UI EVENT HANDLERS ---
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setTransactionInput(prev => ({ ...prev, [name]: value }));
  };

  const handleAddTransaction = async (e) => {
    e.preventDefault();
    if (!db || !userId) {
      console.error("Database or user not ready.");
      return;
    }
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    const transactionsCollection = collection(db, `/artifacts/${appId}/users/${userId}/transactions`);
    try {
      const newTransaction = {
        ...transactionInput,
        amount: parseFloat(transactionInput.amount),
        timestamp: serverTimestamp(),
      };
      await addDoc(transactionsCollection, newTransaction);
      setTransactionInput({ amount: '', type: 'expense', account: '', currency: 'USD', description: '' });
    } catch (e) {
      console.error("Error adding document: ", e);
    }
  };

  const totalIncome = transactions
    .filter(t => t.type === 'income')
    .reduce((sum, t) => sum + (t.amount || 0), 0);
  const totalExpenses = transactions
    .filter(t => t.type === 'expense')
    .reduce((sum, t) => sum + (t.amount || 0), 0);
  const netWorth = totalIncome - totalExpenses;

  return (
    <div className="flex h-screen bg-gray-100 font-inter">
      {/* Transaction Input Panel */}
      <div className="w-1/3 flex flex-col p-6 bg-white border-r border-gray-200">
        <h2 className="text-2xl font-bold text-gray-800 mb-4">Add Transaction</h2>
        <form onSubmit={handleAddTransaction} className="space-y-4">
          <div>
            <label htmlFor="amount" className="block text-sm font-medium text-gray-700">Amount</label>
            <input
              type="number"
              name="amount"
              id="amount"
              value={transactionInput.amount}
              onChange={handleInputChange}
              required
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label htmlFor="currency" className="block text-sm font-medium text-gray-700">Currency</label>
            <input
              type="text"
              name="currency"
              id="currency"
              value={transactionInput.currency}
              onChange={handleInputChange}
              required
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label htmlFor="type" className="block text-sm font-medium text-gray-700">Type</label>
            <select
              name="type"
              id="type"
              value={transactionInput.type}
              onChange={handleInputChange}
              required
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
            >
              <option value="expense">Expense</option>
              <option value="income">Income</option>
            </select>
          </div>
          <div>
            <label htmlFor="account" className="block text-sm font-medium text-gray-700">Account</label>
            <input
              type="text"
              name="account"
              id="account"
              value={transactionInput.account}
              onChange={handleInputChange}
              required
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label htmlFor="description" className="block text-sm font-medium text-gray-700">Description</label>
            <input
              type="text"
              name="description"
              id="description"
              value={transactionInput.description}
              onChange={handleInputChange}
              required
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
            />
          </div>
          <button
            type="submit"
            className="w-full py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            Add Transaction
          </button>
        </form>

        <div className="mt-8">
          <h3 className="text-lg font-bold text-gray-800">Your Current Financials</h3>
          <p className="mt-2 text-gray-700">Total Income: <span className="font-semibold text-green-600">${totalIncome.toFixed(2)}</span></p>
          <p className="text-gray-700">Total Expenses: <span className="font-semibold text-red-600">${totalExpenses.toFixed(2)}</span></p>
          <p className="text-gray-700">Net Worth: <span className="font-semibold text-blue-600">${netWorth.toFixed(2)}</span></p>
        </div>
        
        <div className="mt-8">
          <h3 className="text-lg font-bold text-gray-800">Your Transactions</h3>
          <div className="h-64 overflow-y-auto mt-2 space-y-2">
            {transactions.map(t => (
              <div key={t.id} className="p-3 bg-gray-50 rounded-lg shadow-sm">
                <p className="text-sm font-medium">{t.description}</p>
                <p className={`text-xs ${t.type === 'income' ? 'text-green-600' : 'text-red-600'}`}>
                  {t.type === 'income' ? '+' : '-'}{t.amount.toFixed(2)} {t.currency || ''}
                </p>
                <p className="text-xs text-gray-500">{t.account}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-4 text-xs text-gray-500 text-center">
            User ID: {userId || 'Authenticating...'}
        </div>
      </div>

      {/* Chat Interface Panel */}
      <div className="w-2/3 flex flex-col p-6">
        <h2 className="text-2xl font-bold text-gray-800 mb-4">Chat with your Financial Agent</h2>
        {/* New buttons for AI features */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={handleGenerateSummary}
            className="flex-1 py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
          >
            ✨ Get AI Financial Summary ✨
          </button>
          <button
            onClick={handleGenerateInvoice}
            className="flex-1 py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
          >
            ✨ Generate Invoice ✨
          </button>
        </div>
        <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-4">
          {chatHistory.map((message, index) => (
            <div
              key={index}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[70%] p-3 rounded-lg shadow-md ${
                  message.role === 'user'
                    ? 'bg-blue-500 text-white rounded-br-none'
                    : 'bg-white text-gray-800 rounded-bl-none'
                }`}
              >
                {message.parts.map((part, partIndex) => {
                  if (part.text) {
                    return <p key={partIndex} className="text-sm">{part.text}</p>;
                  }
                  if (part.functionCall) {
                    return (
                      <div key={partIndex} className="bg-gray-200 text-gray-700 p-2 rounded-md font-mono text-xs">
                        <pre><code>
                          {JSON.stringify(part.functionCall, null, 2)}
                        </code></pre>
                      </div>
                    );
                  }
                  if (part.functionResponse) {
                    return (
                      <div key={partIndex} className="bg-gray-200 text-gray-700 p-2 rounded-md font-mono text-xs">
                        <pre><code>
                          {JSON.stringify(part.functionResponse, null, 2)}
                        </code></pre>
                      </div>
                    );
                  }
                  return null;
                })}
              </div>
            </div>
          ))}
          {isTyping && (
            <div className="flex justify-start">
              <div className="bg-white p-3 rounded-lg rounded-bl-none shadow-md">
                <div className="flex space-x-1">
                  <span className="w-2 h-2 bg-gray-500 rounded-full animate-pulse-slow-delay1"></span>
                  <span className="w-2 h-2 bg-gray-500 rounded-full animate-pulse-slow-delay2"></span>
                  <span className="w-2 h-2 bg-gray-500 rounded-full animate-pulse-slow-delay3"></span>
                </div>
              </div>
            </div>
          )}
          <div ref={chatEndRef}></div>
        </div>
        <form onSubmit={handleSendMessage} className="flex">
          <input
            type="text"
            value={userMessage}
            onChange={(e) => setUserMessage(e.target.value)}
            placeholder="Ask your agent something, e.g., 'What was my total spending this month?'"
            className="flex-1 p-3 rounded-l-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
          <button
            type="submit"
            className="p-3 bg-indigo-600 text-white rounded-r-lg shadow-md hover:bg-indigo-700 transition-colors"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}

