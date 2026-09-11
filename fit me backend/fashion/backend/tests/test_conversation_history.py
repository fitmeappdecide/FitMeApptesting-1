"""
Integration Test Suite for AVA Chat History, Conversation Retrieval, and Isolation.
Tests:
- Creating multiple distinct conversations
- Continuing active conversation via conversation_id
- Fetching conversation list via GET /api/v1/ava/conversations
- Fetching messages for specific conversation via GET /api/v1/ava/conversations/{id}/messages
- Verifying conversation isolation and state preservation
"""
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.mark.asyncio
async def test_ava_conversation_history_and_isolation(override_deps_for_tests):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        # Step 1: Start Conversation 1
        prompt1 = "Suggest me a college outfit from Myntra under ₹2500."
        res1 = await client.post("/api/v1/ava/chat", json={"message": prompt1})
        assert res1.status_code == 200
        data1 = res1.json()
        conv1_id = data1["conversation_id"]
        assert conv1_id is not None
        assert data1["intent"] == "outfit_recommendation"

        # Step 2: Continue Conversation 1
        prompt1_cont = "Make the first outfit cheaper."
        res1_cont = await client.post("/api/v1/ava/chat", json={
            "message": prompt1_cont,
            "conversation_id": conv1_id,
            "selected_outfit": data1["outfits"][0] if data1["outfits"] else None
        })
        assert res1_cont.status_code == 200
        data1_cont = res1_cont.json()
        assert data1_cont["conversation_id"] == conv1_id
        assert data1_cont["intent"] == "make_cheaper"

        # Step 3: Start Conversation 2 (New Chat)
        prompt2 = "Only AJIO. Give me an ethnic wedding outfit under ₹5000."
        res2 = await client.post("/api/v1/ava/chat", json={"message": prompt2})
        assert res2.status_code == 200
        data2 = res2.json()
        conv2_id = data2["conversation_id"]
        assert conv2_id is not None
        assert conv2_id != conv1_id  # Isolated conversations

        # Step 4: Retrieve Conversations List
        res_convs = await client.get("/api/v1/ava/conversations")
        assert res_convs.status_code == 200
        conv_list = res_convs.json()
        assert len(conv_list) >= 2
        ids = [c["id"] for c in conv_list]
        assert conv1_id in ids
        assert conv2_id in ids

        # Step 5: Retrieve Messages for Conversation 1
        res_msgs1 = await client.get(f"/api/v1/ava/conversations/{conv1_id}/messages")
        assert res_msgs1.status_code == 200
        data_msgs1 = res_msgs1.json()
        assert data_msgs1["conversation_id"] == conv1_id
        msgs1 = data_msgs1["messages"]
        assert len(msgs1) == 4  # 2 user messages + 2 ava responses
        user_texts1 = [m["text"] for m in msgs1 if m["sender"] == "user"]
        assert prompt1 in user_texts1
        assert prompt1_cont in user_texts1
        assert prompt2 not in user_texts1  # Conversation isolation

        # Step 6: Retrieve Messages for Conversation 2
        res_msgs2 = await client.get(f"/api/v1/ava/conversations/{conv2_id}/messages")
        assert res_msgs2.status_code == 200
        data_msgs2 = res_msgs2.json()
        assert data_msgs2["conversation_id"] == conv2_id
        msgs2 = data_msgs2["messages"]
        assert len(msgs2) == 2  # 1 user message + 1 ava response
        user_texts2 = [m["text"] for m in msgs2 if m["sender"] == "user"]
        assert prompt2 in user_texts2
        assert prompt1 not in user_texts2  # Conversation isolation
